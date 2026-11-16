import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendInAppNotification } from "@/lib/notifications";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Allowed roles
const ROLES = ["ADMIN", "LIBRARIAN", "STUDENT", "TEACHER", "STAFF"];
const DEFAULT_PAGE_SIZE = 10;

// GET /api/admin/users - List users with pagination, search, filter
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Daftar & detail pengguna adalah administrasi akun — hanya ADMIN.
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const role = searchParams.get("role") || "";
  const includeInactive = searchParams.get("includeInactive") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));

  const where: Record<string, unknown> = {};
  if (!includeInactive) {
    where.isActive = true;
  }
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
      { identityNumber: { contains: search } },
    ];
  }

  // Support comma-separated multi-role filter e.g. role=STUDENT,TEACHER,STAFF
  const requestedRoles = role
    .split(",")
    .map((r) => r.trim())
    .filter((r) => ROLES.includes(r));

  // ADMIN boleh memfilter seluruh role. Filter diterapkan apa adanya.
  const effectiveRoles = requestedRoles;

  if (effectiveRoles.length === 1) {
    where.role = effectiveRoles[0];
  } else if (effectiveRoles.length > 1) {
    where.role = { in: effectiveRoles };
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        identityNumber: true,
        class: true,
        createdAt: true,
        updatedAt: true,
        // Never return passwordHash
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({
    users,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
  });
}

// POST /api/admin/users - Create new user
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, email, password, role, identityNumber, class: userClass, phone } = body;

  // Validation
  if (!name?.trim()) return NextResponse.json({ error: "Nama wajib diisi" }, { status: 400 });
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email tidak valid" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Password minimal 6 karakter" }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Role tidak valid" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });

  // Optional phone handling
  let normalizedPhone: string | null = null;
  if (phone !== undefined && phone !== null && String(phone).trim() !== "") {
    normalizedPhone = normalizeWhatsAppNumber(String(phone));
    if (!normalizedPhone) {
      return NextResponse.json({ error: "Nomor HP tidak valid. Contoh: 081234567890." }, { status: 400 });
    }
    const existingPhone = await prisma.user.findUnique({ where: { whatsappNumber: normalizedPhone } });
    if (existingPhone) {
      return NextResponse.json({ error: "Nomor WhatsApp sudah digunakan oleh akun lain." }, { status: 409 });
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role,
        identityNumber: identityNumber?.trim() || null,
        class: userClass?.trim() || null,
        ...(normalizedPhone ? { whatsappNumber: normalizedPhone, whatsappVerified: false } : {}),
      },
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, identityNumber: true, class: true, createdAt: true,
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Nomor WhatsApp sudah digunakan oleh akun lain." }, { status: 409 });
    }
    throw error;
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: "CREATE_USER",
      userId: session.user.id,
      details: `Membuat pengguna baru: ${user.email} (${user.role})`,
    },
  });

  // Notifikasi selamat datang untuk pemilik akun baru. Teks yang sama dipakai
  // untuk in-app dan WhatsApp (WhatsApp hanya untuk nomor terverifikasi).
  await sendInAppNotification(
    user.id,
    "Akun Berhasil Dibuat",
    "Akun DigiLib Anda berhasil dibuat.",
    "SUCCESS",
    "/profile",
    { eventKey: `user:created:${user.id}`, category: "ACCOUNT" }
  );

  return NextResponse.json({ user }, { status: 201 });
}
