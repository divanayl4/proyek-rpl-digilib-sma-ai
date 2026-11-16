/**
 * Validasi "Alasan Peminjaman Buku" pada POST /api/borrows.
 *
 * Aturan:
 *  - Siswa & Guru yang mengajukan sendiri wajib mengisi alasan.
 *  - Alasan hanya berisi spasi ditolak.
 *  - Panjang maksimal mengikuti LIBRARY_CONFIG.borrowReasonMaxLength.
 *  - Alasan disimpan setelah di-trim pada record yang benar (peminjam = sesi).
 *  - Penyerahan langsung oleh Pustakawan tidak terikat aturan pengajuan ini.
 */

import { NextRequest } from "next/server";
import { LIBRARY_CONFIG } from "@/lib/config/library";

const mockGetServerSession = jest.fn();
const mockTx = {
  user: { findUnique: jest.fn() },
  borrowRecord: {
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  book: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
};

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(mockTx)),
  },
}));

jest.mock("@/lib/notifications", () => ({
  notifyBorrowSuccess: jest.fn(async () => undefined),
  notifyLibrarians: jest.fn(async () => undefined),
}));

import { POST as createBorrow } from "@/app/api/borrows/route";

function borrowRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/borrows", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function prepareSuccessfulTransaction(role: string) {
  mockTx.user.findUnique.mockResolvedValue({ id: "user-1", role, isActive: true, name: "Peminjam" });
  mockTx.borrowRecord.count.mockResolvedValue(0);
  mockTx.borrowRecord.findFirst.mockResolvedValue(null);
  mockTx.book.findUnique.mockResolvedValue({ id: "bk-1", title: "Buku", format: "PHYSICAL", stock: 5 });
  mockTx.borrowRecord.create.mockResolvedValue({
    id: "br-1",
    userId: "user-1",
    status: "REQUESTED",
    dueDate: new Date(Date.now() + 7 * 86400000),
    user: { id: "user-1", name: "Peminjam", email: null, role },
    book: { id: "bk-1", title: "Buku", author: "Penulis", isbn: null },
    createdBy: { id: "user-1", name: "Peminjam" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "STUDENT" } });
  Object.values(mockTx).forEach((model) => {
    Object.values(model).forEach((mock) => (mock as jest.Mock).mockReset());
  });
});

describe("POST /api/borrows — alasan peminjaman Siswa/Guru", () => {
  it("menolak pengajuan Siswa tanpa alasan", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "STUDENT" } });
    prepareSuccessfulTransaction("STUDENT");

    const res = await createBorrow(borrowRequest({ bookId: "bk-1" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/alasan peminjaman buku wajib diisi/i);
    expect(mockTx.borrowRecord.create).not.toHaveBeenCalled();
  });

  it("menolak alasan yang hanya berisi spasi", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "TEACHER" } });
    prepareSuccessfulTransaction("TEACHER");

    const res = await createBorrow(borrowRequest({ bookId: "bk-1", reason: "     " }));

    expect(res.status).toBe(400);
    expect(mockTx.borrowRecord.create).not.toHaveBeenCalled();
  });

  it("menolak alasan yang melebihi batas karakter", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "STUDENT" } });
    prepareSuccessfulTransaction("STUDENT");

    const res = await createBorrow(
      borrowRequest({ bookId: "bk-1", reason: "a".repeat(LIBRARY_CONFIG.borrowReasonMaxLength + 1) })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/maksimal/i);
    expect(mockTx.borrowRecord.create).not.toHaveBeenCalled();
  });

  it("menyimpan alasan Siswa yang sudah di-trim pada pengajuan milik sesi", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "STUDENT" } });
    prepareSuccessfulTransaction("STUDENT");

    const res = await createBorrow(
      borrowRequest({
        bookId: "bk-1",
        userId: "orang-lain",
        role: "ADMIN",
        reason: "  Untuk belajar ujian  ",
      })
    );

    expect(res.status).toBe(201);
    expect(mockTx.borrowRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          borrowReason: "Untuk belajar ujian",
        }),
      })
    );
  });

  it("menerima alasan Guru yang valid", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "TEACHER" } });
    prepareSuccessfulTransaction("TEACHER");

    const res = await createBorrow(
      borrowRequest({ bookId: "bk-1", reason: "Bahan ajar kelas XII" })
    );

    expect(res.status).toBe(201);
    expect(mockTx.borrowRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ borrowReason: "Bahan ajar kelas XII" }),
      })
    );
  });
});
