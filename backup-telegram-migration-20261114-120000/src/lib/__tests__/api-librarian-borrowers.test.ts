/**
 * Authorization tests for GET /api/librarian/borrowers.
 *
 * Endpoint ini menggantikan pemakaian daftar pengguna ADMIN untuk modal
 * "Buat Peminjaman" di meja sirkulasi. Hanya Pustakawan/Admin yang boleh
 * mencari anggota, dan hasilnya dibatasi ke role peminjam tanpa kredensial.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockFindMany = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import { GET } from "@/app/api/librarian/borrowers/route";

function signInAs(role: string | null) {
  mockGetServerSession.mockResolvedValue(
    role ? { user: { id: "staff-1", role } } : null
  );
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/librarian/borrowers${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([
    {
      id: "student-1",
      name: "Siswa Satu",
      email: "siswa@sma.id",
      role: "STUDENT",
      class: "XI TKJ",
      identityNumber: "2024001",
      isActive: true,
    },
  ]);
});

describe("GET /api/librarian/borrowers — otorisasi", () => {
  it("menolak request tanpa sesi (401)", async () => {
    signInAs(null);
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "menolak role %s (403)",
    async (role) => {
      signInAs(role);
      const res = await GET(request());
      expect(res.status).toBe(403);
      expect(mockFindMany).not.toHaveBeenCalled();
    }
  );

  it.each(["ADMIN", "LIBRARIAN"])("mengizinkan %s", async (role) => {
    signInAs(role);
    const res = await GET(request());
    expect(res.status).toBe(200);
  });
});

describe("GET /api/librarian/borrowers — batas data", () => {
  beforeEach(() => signInAs("LIBRARIAN"));

  it("hanya mencari role peminjam yang sah", async () => {
    await GET(request("?search=Siswa"));
    const call = mockFindMany.mock.calls[0][0];

    expect(call.where.role).toEqual({ in: ["STUDENT", "TEACHER", "STAFF"] });
    expect(call.where.OR).toEqual([
      { name: { contains: "Siswa" } },
      { email: { contains: "Siswa" } },
      { identityNumber: { contains: "Siswa" } },
    ]);
  });

  it("tidak memilih password, hash, token, atau data sensitif lain", async () => {
    await GET(request());
    const select = mockFindMany.mock.calls[0][0].select;

    expect(select).toEqual({
      id: true,
      name: true,
      email: true,
      role: true,
      class: true,
      identityNumber: true,
      isActive: true,
    });
    expect(select).not.toHaveProperty("passwordHash");
    expect(select).not.toHaveProperty("telegramChatId");
  });

  it("membatasi pageSize maksimal 20", async () => {
    await GET(request("?pageSize=500"));
    expect(mockFindMany.mock.calls[0][0].take).toBe(20);
  });
});
