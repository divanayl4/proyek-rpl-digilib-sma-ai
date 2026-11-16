/**
 * Bagian C — Akses buku oleh ADMIN/LIBRARIAN tanpa membuat transaksi.
 *
 * Yang diuji:
 *  - GET /api/books/[id] (detail buku fisik) hanya MEMBACA: tidak membuat
 *    BorrowRecord, tidak mengubah stok, tidak mengirim notifikasi.
 *  - POST /api/borrows: ADMIN/LIBRARIAN TIDAK dapat meminjam buku fisik untuk
 *    dirinya sendiri (role diambil dari database; borrowerRoles = Siswa/Guru/Staf).
 *  - Penyerahan langsung oleh Pustakawan kepada SISWA tetap berjalan (staf
 *    bertindak atas nama anggota, bukan meminjam untuk diri sendiri).
 *  - Role palsu di body TIDAK memberi hak: siswa yang menyisipkan `userId` orang
 *    lain tetap mencatat peminjaman atas namanya sendiri.
 *  - Peminjaman ebook oleh ADMIN/LIBRARIAN sudah ditolak (lihat
 *    api-ebooks-borrow.test.ts); akses baca operator tanpa EbookLoan diuji di
 *    api-ebooks-operator.test.ts.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockBookFindUnique = jest.fn();
const mockBookUpdate = jest.fn();

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
    book: { findUnique: (...a: unknown[]) => mockBookFindUnique(...a), update: (...a: unknown[]) => mockBookUpdate(...a) },
    borrowRecord: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    ebookLoan: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

jest.mock("@/lib/notifications", () => ({
  notifyBorrowSuccess: jest.fn(async () => undefined),
  notifyLibrarians: jest.fn(async () => undefined),
  notifyEbookBorrowed: jest.fn(async () => undefined),
  notifyEbookReturned: jest.fn(async () => undefined),
  notifyEbookExpired: jest.fn(async () => undefined),
}));

import { GET as getBookDetail } from "@/app/api/books/[id]/route";
import { POST as createBorrow } from "@/app/api/borrows/route";
import { notifyBorrowSuccess, notifyLibrarians } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const PHYSICAL_BOOK = {
  id: "bk-1",
  title: "Bumi Manusia",
  author: "Pramoedya Ananta Toer",
  format: "PHYSICAL",
  stock: 5,
  category: null,
  _count: { borrows: 2 },
};

function borrowRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/borrows", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "u-1", role: "STUDENT" } });
  mockBookFindUnique.mockResolvedValue(PHYSICAL_BOOK);
  Object.values(mockTx).forEach((model) => {
    Object.values(model).forEach((mock) => (mock as jest.Mock).mockReset());
  });
});

describe("GET /api/books/[id] — baca detail tanpa efek samping", () => {
  it("mengembalikan detail buku dengan stok tersedia yang dihitung, tanpa menulis", async () => {
    const res = await getBookDetail(
      new NextRequest("http://localhost:3000/api/books/bk-1"),
      { params: { id: "bk-1" } }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.book.title).toBe("Bumi Manusia");
    expect(body.book.available).toBe(3); // 5 stok - 2 dipinjam aktif
    expect(body.book.stock).toBe(5); // stok TIDAK berubah
    // Tidak ada transaksi/notifikasi apa pun yang dibuat.
    expect(mockBookUpdate).not.toHaveBeenCalled();
    expect(prisma.borrowRecord.create).not.toHaveBeenCalled();
    expect(prisma.ebookLoan.create).not.toHaveBeenCalled();
    expect(notifyBorrowSuccess).not.toHaveBeenCalled();
    expect(notifyLibrarians).not.toHaveBeenCalled();
  });

  it("dapat diakses ADMIN/LIBRARIAN sebagai katalog tanpa sesi (tanpa transaksi)", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getBookDetail(
      new NextRequest("http://localhost:3000/api/books/bk-1"),
      { params: { id: "bk-1" } }
    );
    expect(res.status).toBe(200);
    expect(prisma.borrowRecord.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/borrows — ADMIN/LIBRARIAN tidak meminjam untuk diri sendiri", () => {
  it("menolak ADMIN tanpa targetUserId dan tidak membuat transaksi", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "adm-1", role: "ADMIN" } });
    mockTx.user.findUnique.mockResolvedValue({ id: "adm-1", role: "ADMIN", isActive: true, name: "Admin Utama" });

    const res = await createBorrow(borrowRequest({ bookId: "bk-1" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/tidak diizinkan/i);
    expect(mockTx.borrowRecord.create).not.toHaveBeenCalled();
    expect(notifyBorrowSuccess).not.toHaveBeenCalled();
  });

  it("menolak LIBRARIAN tanpa targetUserId dan tidak membuat transaksi", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "lib-1", role: "LIBRARIAN" } });
    mockTx.user.findUnique.mockResolvedValue({ id: "lib-1", role: "LIBRARIAN", isActive: true, name: "Budi" });

    const res = await createBorrow(borrowRequest({ bookId: "bk-1" }));
    expect(res.status).toBe(400);
    expect(mockTx.borrowRecord.create).not.toHaveBeenCalled();
  });

  it("tetap mengizinkan Pustakawan menyerahkan buku kepada siswa (direct handover)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "lib-1", role: "LIBRARIAN" } });
    mockTx.user.findUnique.mockResolvedValue({ id: "stu-1", role: "STUDENT", isActive: true, name: "Najla" });
    mockTx.borrowRecord.count.mockResolvedValue(0);
    mockTx.borrowRecord.findFirst.mockResolvedValue(null);
    mockTx.book.findUnique.mockResolvedValue({ id: "bk-1", title: "Bumi Manusia", format: "PHYSICAL", stock: 5 });
    mockTx.borrowRecord.create.mockResolvedValue({
      id: "br-new",
      userId: "stu-1",
      status: "BORROWED",
      dueDate: new Date(Date.now() + 7 * 86400000),
      user: { id: "stu-1", name: "Najla", email: null, role: "STUDENT" },
      book: { id: "bk-1", title: "Bumi Manusia", author: "Pramoedya", isbn: null },
      createdBy: { id: "lib-1", name: "Budi" },
    });

    const res = await createBorrow(borrowRequest({ bookId: "bk-1", userId: "stu-1" }));
    expect(res.status).toBe(201);
    expect(mockTx.borrowRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "stu-1" }) })
    );
  });

  it("mengabaikan userId di body dari sesi SISWA (tidak meminjam atas nama orang lain)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-9", role: "STUDENT" } });
    mockTx.user.findUnique.mockResolvedValue({ id: "stu-9", role: "STUDENT", isActive: true, name: "Siswa" });
    mockTx.borrowRecord.count.mockResolvedValue(0);
    mockTx.borrowRecord.findFirst.mockResolvedValue(null);
    mockTx.book.findUnique.mockResolvedValue({ id: "bk-1", title: "Bumi Manusia", format: "PHYSICAL", stock: 5 });
    mockTx.borrowRecord.create.mockResolvedValue({
      id: "br-new",
      userId: "stu-9",
      status: "REQUESTED",
      dueDate: new Date(Date.now() + 7 * 86400000),
      user: { id: "stu-9", name: "Siswa", email: null, role: "STUDENT" },
      book: { id: "bk-1", title: "Bumi Manusia", author: "Pramoedya", isbn: null },
      createdBy: { id: "stu-9", name: "Siswa" },
    });

    // Siswa mencoba menyisipkan userId orang lain + role palsu via body.
    const res = await createBorrow(
      borrowRequest({
        bookId: "bk-1",
        userId: "victim-1",
        role: "ADMIN",
        reason: "Untuk tugas sekolah",
      })
    );

    expect(res.status).toBe(201);
    // Borrower tetap dari sesi, bukan dari body.
    expect(mockTx.user.findUnique).toHaveBeenCalledWith({ where: { id: "stu-9" } });
    expect(mockTx.borrowRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "stu-9" }) })
    );
  });
});
