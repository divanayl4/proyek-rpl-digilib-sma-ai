import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock("bcryptjs", () => {
  const mockHash = jest.fn();
  return {
    __esModule: true,
    default: {
      hash: mockHash,
    },
    hash: mockHash,
  };
});

jest.mock("@/lib/notifications", () => ({
  sendInAppNotification: jest.fn().mockResolvedValue(true),
}));

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendInAppNotification } from "@/lib/notifications";
import { POST as registerHandler } from "@/app/api/register/route";

function createJsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/register (Student Registration)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null); // default no active session
  });

  it("should reject registration if user already has an active session (409 Conflict)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u-active", role: "STUDENT" } });

    const req = createJsonRequest({
      name: "Siswa Baru",
      email: "baru@sekolah.sch.id",
      password: "password123",
      nis: "12345",
    });

    const res = await registerHandler(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe("Sudah punya akun. Silakan login.");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("should return 400 if name or email is missing or empty", async () => {
    const invalidInputs = [
      { name: "", email: "siswa@sekolah.sch.id", password: "password123", nis: "123" },
      { name: "   ", email: "siswa@sekolah.sch.id", password: "password123", nis: "123" },
      { name: "Budi", email: "", password: "password123", nis: "123" },
      { name: "Budi", email: "   ", password: "password123", nis: "123" },
    ];

    for (const input of invalidInputs) {
      const res = await registerHandler(createJsonRequest(input));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("Nama dan email wajib diisi");
    }
  });

  it("should return 400 if password is less than 6 characters", async () => {
    const res = await registerHandler(
      createJsonRequest({
        name: "Siti",
        email: "siti@sekolah.sch.id",
        password: "12345",
        nis: "54321",
      })
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Password minimal 6 karakter");
  });

  it("should return 400 if NIS is missing or empty", async () => {
    const res = await registerHandler(
      createJsonRequest({
        name: "Siti",
        email: "siti@sekolah.sch.id",
        password: "password123",
        nis: "   ",
      })
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("NIS wajib diisi");
  });

  it("should return 409 if email is already registered", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "u-exist",
      email: "terdaftar@sekolah.sch.id",
    });

    const res = await registerHandler(
      createJsonRequest({
        name: "Ahmad",
        email: "  TERDAFTAR@Sekolah.sch.id  ",
        password: "password123",
        nis: "99999",
      })
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe("Email sudah terdaftar");
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "terdaftar@sekolah.sch.id" },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("should successfully register student with role STUDENT, hash password, create audit log and notification", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (bcrypt.hash as jest.Mock).mockResolvedValue("mocked_hash_value");

    const createdUser = {
      id: "u-new-student",
      name: "Rian Pratama",
      email: "rian@sekolah.sch.id",
      role: "STUDENT",
      identityNumber: "NIS-00123",
      class: "X RPL 1",
    };
    (prisma.user.create as jest.Mock).mockResolvedValue(createdUser);

    const req = createJsonRequest({
      name: "  Rian Pratama  ",
      email: "  RIAN@sekolah.sch.id  ",
      password: "securePassword123",
      nis: "  NIS-00123  ",
      class: "  X RPL 1  ",
    });

    const res = await registerHandler(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.user).toEqual(createdUser);

    expect(bcrypt.hash).toHaveBeenCalledWith("securePassword123", 12);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        name: "Rian Pratama",
        email: "rian@sekolah.sch.id",
        passwordHash: "mocked_hash_value",
        role: "STUDENT",
        identityNumber: "NIS-00123",
        class: "X RPL 1",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        identityNumber: true,
        class: true,
      },
    });

    // Check Audit Log
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "REGISTER_STUDENT",
        userId: "u-new-student",
        details: "Siswa baru terdaftar: rian@sekolah.sch.id (STUDENT)",
      },
    });

    // Check Welcome Notification
    expect(sendInAppNotification).toHaveBeenCalledWith(
      "u-new-student",
      "Akun Berhasil Dibuat",
      "Akun DigiLib Anda berhasil dibuat.",
      "SUCCESS",
      "/profile",
      { eventKey: "user:created:u-new-student" }
    );
  });

  it("should return 500 when database throws an exception", async () => {
    (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error("Database connection lost"));

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await registerHandler(
      createJsonRequest({
        name: "Siswa",
        email: "siswa@sekolah.sch.id",
        password: "password123",
        nis: "12345",
      })
    );
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("Gagal terhubung ke server");

    consoleSpy.mockRestore();
  });
});
