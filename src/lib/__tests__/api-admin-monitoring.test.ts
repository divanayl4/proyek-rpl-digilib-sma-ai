/**
 * Authorization & privacy tests for GET /api/admin/monitoring.
 *
 * Monitoring student/teacher activity is ADMIN-only and must be enforced from
 * the server session. The payload never contains emails, passwords, or tokens.
 */

const mockGetServerSession = jest.fn();
const mockBorrowCount = jest.fn();
const mockEbookCount = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockEbookFindMany = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    borrowRecord: {
      count: (...args: unknown[]) => mockBorrowCount(...args),
      findMany: (...args: unknown[]) => mockBorrowFindMany(...args),
      groupBy: jest.fn(async () => []),
    },
    ebookLoan: {
      count: (...args: unknown[]) => mockEbookCount(...args),
      findMany: (...args: unknown[]) => mockEbookFindMany(...args),
    },
  },
}));

jest.mock("@/lib/transactionStats", () => ({
  getTransactionStats: jest.fn(async () => ({
    total: 15,
    physicalTotal: 10,
    ebookTotal: 5,
  })),
}));

import { GET } from "@/app/api/admin/monitoring/route";

function signInAs(role: string | null) {
  mockGetServerSession.mockResolvedValue(
    role ? { user: { id: "admin-1", role } } : null
  );
}

const now = Date.now();

beforeEach(() => {
  jest.clearAllMocks();
  mockBorrowCount
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(10)
    .mockResolvedValueOnce(5);
  mockEbookCount.mockResolvedValue(3);
  mockBorrowFindMany.mockResolvedValue([
    {
      id: "borrow-1",
      borrowDate: new Date(now - 3 * 24 * 60 * 60 * 1000),
      dueDate: new Date(now - 24 * 60 * 60 * 1000),
      returnDate: null,
      status: "BORROWED",
      user: {
        name: "Siswa Satu",
        role: "STUDENT",
        class: "XI TKJ",
        identityNumber: "2024001",
      },
      book: { title: "Fisika", author: "Yohanes" },
    },
  ]);
  mockEbookFindMany.mockResolvedValue([
    {
      id: "ebook-1",
      borrowedAt: new Date(now - 60 * 60 * 1000),
      expiresAt: new Date(now + 24 * 60 * 60 * 1000),
      returnedAt: null,
      status: "ACTIVE",
      user: {
        name: "Pak Guru",
        role: "TEACHER",
        class: null,
        identityNumber: "1987001",
      },
      book: { title: "Ebook Jaringan", author: "Budi" },
    },
  ]);
});

describe("GET /api/admin/monitoring — otorisasi", () => {
  it("menolak request tanpa sesi (401)", async () => {
    signInAs(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it.each(["LIBRARIAN", "STUDENT", "TEACHER", "STAFF"])(
    "menolak role %s (403) tanpa query data",
    async (role) => {
      signInAs(role);
      const res = await GET();
      expect(res.status).toBe(403);
      expect(mockBorrowFindMany).not.toHaveBeenCalled();
      expect(mockEbookFindMany).not.toHaveBeenCalled();
      expect(mockBorrowCount).not.toHaveBeenCalled();
      expect(mockEbookCount).not.toHaveBeenCalled();
    }
  );
});

describe("GET /api/admin/monitoring — data aktivitas", () => {
  beforeEach(() => signInAs("ADMIN"));

  it("hanya memantau Siswa & Guru dan mengembalikan ringkasan", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary).toEqual({
      studentActiveBorrows: 2,
      teacherActiveBorrows: 1,
      studentTotalBorrows: 10,
      teacherTotalBorrows: 5,
      activeEbookLoans: 3,
      totalTransactions: 15,
      totalPhysicalBorrows: 10,
      totalEbookLoans: 5,
    });

    for (const call of mockBorrowFindMany.mock.calls) {
      expect(call[0].where.user.role).toEqual({ in: ["STUDENT", "TEACHER"] });
    }
    for (const call of mockEbookFindMany.mock.calls) {
      expect(call[0].where.user.role).toEqual({ in: ["STUDENT", "TEACHER"] });
    }
  });

  it("menurunkan status keterlambatan dari tanggal, bukan hanya kolom status", async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.borrows[0]).toMatchObject({
      status: "BORROWED",
      effectiveStatus: "OVERDUE",
      user: { name: "Siswa Satu", role: "STUDENT" },
    });
  });

  it("menurunkan status ebook aktif dari timestamp", async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.ebookLoans[0].status).toBe("ACTIVE");
    expect(body.ebookLoans[0].book.title).toBe("Ebook Jaringan");
  });

  it("tidak mengembalikan email, password, token, atau hash", async () => {
    const res = await GET();
    const serialized = JSON.stringify(await res.json()).toLowerCase();

    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("hash");
  });
});
