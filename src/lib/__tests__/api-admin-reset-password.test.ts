/**
 * Security tests for POST /api/admin/users/[id]/reset-password.
 *
 * - Only ADMIN (verified from the server session) may reset a password.
 * - The response never contains the old hash, the new password, or a hash.
 * - Audit logging never records the new password.
 */

const mockGetServerSession = jest.fn();
const mockHash = jest.fn(async (..._args: unknown[]) => "NEW-HASHED-VALUE");
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("bcryptjs", () => ({
  __esModule: true,
  default: { hash: (...args: unknown[]) => mockHash(...args) },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    auditLog: { create: (...args: unknown[]) => mockAuditCreate(...args) },
  },
}));

import { POST } from "@/app/api/admin/users/[id]/reset-password/route";

const TARGET_ID = "student-1";

function signInAs(role: string | null) {
  mockGetServerSession.mockResolvedValue(
    role ? { user: { id: "admin-1", role } } : null
  );
}

function request(body: unknown) {
  return {
    json: async () => body,
  } as never;
}

function call(body: unknown) {
  return POST(request(body), { params: { id: TARGET_ID } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUnique.mockResolvedValue({
    id: TARGET_ID,
    email: "siswa@sma.id",
    passwordHash: "OLD-HASHED-VALUE",
  });
  mockUpdate.mockResolvedValue({ id: TARGET_ID });
  mockAuditCreate.mockResolvedValue({ id: "audit-1" });
});

describe("POST reset-password — otorisasi", () => {
  it("menolak request tanpa sesi (401)", async () => {
    signInAs(null);
    const res = await call({ newPassword: "rahasia123" });
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each(["LIBRARIAN", "STUDENT", "TEACHER", "STAFF"])(
    "menolak role %s (403) tanpa menyentuh database",
    async (role) => {
      signInAs(role);
      const res = await call({ newPassword: "rahasia123" });
      expect(res.status).toBe(403);
      expect(mockFindUnique).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockHash).not.toHaveBeenCalled();
    }
  );
});

describe("POST reset-password — validasi & keamanan kredensial", () => {
  beforeEach(() => signInAs("ADMIN"));

  it("menolak password yang bukan string atau terlalu pendek", async () => {
    for (const body of [{}, { newPassword: "" }, { newPassword: "123" }, { newPassword: 123456 }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockHash).not.toHaveBeenCalled();
  });

  it("menolak body yang tidak valid", async () => {
    const res = await POST(
      { json: async () => { throw new Error("bad json"); } } as never,
      { params: { id: TARGET_ID } }
    );
    expect(res.status).toBe(400);
  });

  it("mengembalikan 404 bila pengguna target tidak ada", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await call({ newPassword: "rahasia123" });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("menyimpan hash baru dan tidak pernah mengembalikan password/hash", async () => {
    const res = await call({ newPassword: "rahasia123" });
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(res.status).toBe(200);
    expect(mockHash).toHaveBeenCalledWith("rahasia123", 12);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      data: { passwordHash: "NEW-HASHED-VALUE" },
    });

    expect(body).toEqual({ message: "Password berhasil direset" });
    expect(serialized).not.toContain("rahasia123");
    expect(serialized).not.toContain("NEW-HASHED-VALUE");
    expect(serialized).not.toContain("OLD-HASHED-VALUE");
    expect(serialized).not.toMatch(/passwordHash/i);
  });

  it("audit log tidak mencatat password atau hash", async () => {
    await call({ newPassword: "rahasia123" });

    const auditSerialized = JSON.stringify(mockAuditCreate.mock.calls[0][0]);
    expect(auditSerialized).not.toContain("rahasia123");
    expect(auditSerialized).not.toContain("NEW-HASHED-VALUE");
    expect(auditSerialized).not.toContain("OLD-HASHED-VALUE");
    expect(auditSerialized).not.toMatch(/passwordHash/i);
  });
});
