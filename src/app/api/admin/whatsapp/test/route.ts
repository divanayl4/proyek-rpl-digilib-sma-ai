import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  checkFonnteConnection,
  getWhatsAppConfig,
  recordConnectionTest,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/whatsapp/test
 *
 * Menguji koneksi/device Fonnte memakai token tersimpan. Token tidak pernah
 * dikembalikan ke klien. Hasil terakhir disimpan untuk status dashboard.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await getWhatsAppConfig();
  if (!config.token) {
    return NextResponse.json(
      { ok: false, message: "Token Fonnte belum dikonfigurasi." },
      { status: 400 }
    );
  }

  const result = await checkFonnteConnection();
  await recordConnectionTest(result);

  return NextResponse.json(
    {
      ok: result.ok,
      connected: result.ok,
      message: result.message,
      deviceName: result.deviceName,
      quota: result.quota,
    },
    { status: result.ok ? 200 : 502 }
  );
}
