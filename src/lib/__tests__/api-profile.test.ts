/**
 * Route-level tests for the self-service profile API.
 *
 * Fokus: identitas diambil dari sesi, role tidak dapat diubah sendiri, dan
 * perubahan password memerlukan verifikasi password lama.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

jest.mock("bcryptjs", () => ({
  __esModule: true,
  default: { compare: jest.fn(), hash: jest.fn() },
}));

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profile/route";

const STUDENT_SESSION = { user: { id: "stu-1", role: "STUDENT" } };

const DB_USER = {
  id: "stu-1",
  name: "Siswa Rajin",
  email: "siswa@sma.id",
  role: "STUDENT",
  gender: "MALE",
  identityNumber: "2024001",
  class: "XII IPA 1",
  isActive: true,
  passwordHash: "hashed-old",
  createdAt: new Date(),
};

function patchReq(body: unknown) {
  return new NextRequest("http://localhost:3000/api/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue(STUDENT_SESSION);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(DB_USER);
  (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
});

describe("GET /api/profile", () => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getProfile();
    expect(res.status).toBe(401);
  });

  it("returns the current user without the password hash", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "stu-1",
      name: "Siswa Rajin",
      email: "siswa@sma.id",
      role: "STUDENT",
      gender: "MALE",
      identityNumber: "2024001",
      class: "XII IPA 1",
      isActive: true,
      createdAt: new Date(),
    });

    const res = await getProfile();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.id).toBe("stu-1");
    expect(body.user).not.toHaveProperty("passwordHash");
  });
});

describe("PATCH /api/profile", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await patchProfile(patchReq({ name: "Baru" }));
    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("updates allowed fields and never lets a user change their own role", async () => {
    (prisma.user.update as jest.Mock).mockImplementation(({ data }) => ({
      ...DB_USER,
      ...data,
    }));

    const res = await patchProfile(
      patchReq({
        name: "Siswa Baru",
        gender: "FEMALE",
        identityNumber: "9999",
        class: "XI IPA 1",
        role: "ADMIN", // harus diabaikan
        isActive: false, // harus diabaikan
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const updateArg = (prisma.user.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data).toMatchObject({
      name: "Siswa Baru",
      gender: "FEMALE",
      identityNumber: "9999",
      class: "XI IPA 1",
    });
    expect(updateArg.data).not.toHaveProperty("role");
    expect(updateArg.data).not.toHaveProperty("isActive");
    expect(body.user.role).toBe("STUDENT");
  });

  it("rejects an empty name", async () => {
    const res = await patchProfile(patchReq({ name: "   " }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid gender", async () => {
    const res = await patchProfile(patchReq({ gender: "OTHER" }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a password change with the wrong current password", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const res = await patchProfile(
      patchReq({ currentPassword: "salah", newPassword: "newpass123" })
    );

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("changes the password when the current password is correct", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-new");
    (prisma.user.update as jest.Mock).mockResolvedValue({
      ...DB_USER,
      passwordHash: "hashed-new",
    });

    const res = await patchProfile(
      patchReq({ currentPassword: "password123", newPassword: "newpass123" })
    );

    expect(res.status).toBe(200);
    expect(bcrypt.hash).toHaveBeenCalledWith("newpass123", 12);
    const updateArg = (prisma.user.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data.passwordHash).toBe("hashed-new");
  });

  it("requires a current password to set a new one", async () => {
    const res = await patchProfile(patchReq({ newPassword: "newpass123" }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a request with no changes", async () => {
    const res = await patchProfile(patchReq({}));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
