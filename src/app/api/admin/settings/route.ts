import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getFinePerDayIDR,
  isFineRateConfigured,
  setFinePerDayIDR,
  getDamageFineConfig,
  setDamageFineIDR,
} from "@/lib/config/settings";
import { LIBRARY_CONFIG, isValidDamageCondition } from "@/lib/config/library";

export const dynamic = "force-dynamic";

/**
 * Pengaturan sistem – saat ini tarif denda harian.
 *
 * GET boleh dibaca oleh Admin dan Pustakawan: pustakawan perlu memverifikasi
 * tarif resmi sebelum menerima pembayaran denda. PATCH (tarif denda) juga boleh
 * dilakukan Pustakawan sesuai kewenangan pengelolaan denda; pengaturan sistem
 * lain tetap eksklusif Admin.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!LIBRARY_CONFIG.librarianRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [finePerDayIDR, configured, damageConditions] = await Promise.all([
    getFinePerDayIDR(),
    isFineRateConfigured(),
    getDamageFineConfig(),
  ]);

  return NextResponse.json({
    settings: {
      finePerDayIDR,
      fineRateConfigured: configured,
      fineRateDefault: LIBRARY_CONFIG.finePerDayIDR,
      damageConditions,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Tarif denda termasuk kewenangan Pustakawan dan Admin.
  if (!LIBRARY_CONFIG.librarianRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Hanya Pustakawan atau Admin yang dapat mengubah tarif denda" }, { status: 403 });
  }

  let body: { finePerDayIDR?: unknown; damageConditions?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const MAX_RATE = 1_000_000;
  const parseRate = (raw: unknown): number | null => {
    const value = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(value) || value < 0 || value > MAX_RATE) return null;
    return value;
  };

  const wantsLate = body.finePerDayIDR !== undefined;
  const wantsDamage = body.damageConditions !== undefined;

  if (!wantsLate && !wantsDamage) {
    return NextResponse.json(
      { error: "Tidak ada tarif yang diubah (finePerDayIDR atau damageConditions)" },
      { status: 400 }
    );
  }

  let lateValue: number | null = null;
  if (wantsLate) {
    lateValue = parseRate(body.finePerDayIDR);
    if (lateValue === null) {
      return NextResponse.json({ error: "Tarif denda harus berupa angka >= 0" }, { status: 400 });
    }
  }

  // damageConditions: { KEY: amount } atau [{ key, amountIDR }]
  const damageUpdates: Array<{ key: string; amount: number }> = [];
  if (wantsDamage) {
    const raw = body.damageConditions;
    const entries: Array<[string, unknown]> = Array.isArray(raw)
      ? raw.map((item) => {
          const row = (item ?? {}) as { key?: unknown; amountIDR?: unknown; amount?: unknown };
          return [String(row.key ?? ""), row.amountIDR ?? row.amount];
        })
      : raw && typeof raw === "object"
        ? Object.entries(raw as Record<string, unknown>)
        : [];

    for (const [key, value] of entries) {
      if (!isValidDamageCondition(key)) {
        return NextResponse.json({ error: `Kategori kondisi tidak dikenal: ${key}` }, { status: 400 });
      }
      const amount = parseRate(value);
      if (amount === null) {
        return NextResponse.json(
          { error: `Tarif untuk ${key} harus angka 0–${MAX_RATE.toLocaleString("id-ID")}` },
          { status: 400 }
        );
      }
      damageUpdates.push({ key, amount });
    }

    if (damageUpdates.length === 0) {
      return NextResponse.json({ error: "Tidak ada kategori kerusakan yang dikirim" }, { status: 400 });
    }
  }

  if (lateValue !== null) await setFinePerDayIDR(lateValue);
  for (const d of damageUpdates) await setDamageFineIDR(d.key, d.amount);

  const detailParts: string[] = [];
  if (lateValue !== null) detailParts.push(`keterlambatan Rp${lateValue.toLocaleString("id-ID")}/hari`);
  if (damageUpdates.length > 0) {
    detailParts.push(
      `kerusakan: ${damageUpdates.map((d) => `${d.key}=Rp${d.amount.toLocaleString("id-ID")}`).join(", ")}`
    );
  }

  await prisma.auditLog.create({
    data: {
      action: "UPDATE_SETTINGS",
      userId: session.user.id,
      details: `Mengubah tarif denda (${detailParts.join("; ")})`,
    },
  });

  const [finePerDayIDR, damageConditions] = await Promise.all([
    getFinePerDayIDR(),
    getDamageFineConfig(),
  ]);

  return NextResponse.json({
    message: "Tarif denda diperbarui",
    settings: { finePerDayIDR, fineRateConfigured: true, damageConditions },
  });
}
