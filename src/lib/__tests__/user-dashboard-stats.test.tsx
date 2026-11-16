/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/components/layout/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/lib/recommendations", () => ({
  getRecommendationsForUser: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: jest.fn() },
    book: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    borrowRecord: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    ebookLoan: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  },
}));

import StudentPage from "@/app/student/page";
import TeacherPage from "@/app/teacher/page";
import LibrarianPage from "@/app/librarian/page";
import { getUserActiveLoans, getUserHistoryTotals } from "@/lib/transactionStats";
import { prisma } from "@/lib/prisma";

function cardValue(label: string): string | null | undefined {
  const labelElement = screen.getByText(label);
  return labelElement.parentElement?.querySelector(".stat-card__value")?.textContent;
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.book.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([]);
});

describe("Pemisahan Statistik Peminjaman Buku Fisik & Ebook pada Dashboard Pengguna", () => {
  describe("getUserActiveLoans helper (Siswa & Guru)", () => {
    it("6 & 7: Peminjaman buku fisik dan ebook terpisah, tidak saling menambah", async () => {
      (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(3);
      (prisma.ebookLoan.count as jest.Mock).mockResolvedValue(1);

      const stats = await getUserActiveLoans("user-1");

      expect(stats.physicalActive).toBe(3);
      expect(stats.ebookActive).toBe(1);

      // Pastikan query BorrowRecord menggunakan status BORROWED & OVERDUE dan userId
      expect(prisma.borrowRecord.count).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          status: { in: ["BORROWED", "OVERDUE"] },
        },
      });

      // Pastikan query EbookLoan menggunakan returnedAt: null dan expiresAt > now dan userId
      expect(prisma.ebookLoan.count).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          returnedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it("8, 9 & 10: Tidak menghitung status non-aktif (kembali, kedaluwarsa, permintaan menunggu)", async () => {
      // Status aktif buku fisik hanya BORROWED dan OVERDUE
      // REQUESTED, RETURNED, REJECTED, CANCELLED tidak boleh dihitung
      (prisma.borrowRecord.count as jest.Mock).mockImplementation(({ where }) => {
        const allowed = where?.status?.in ?? [];
        expect(allowed).toContain("BORROWED");
        expect(allowed).toContain("OVERDUE");
        expect(allowed).not.toContain("REQUESTED");
        expect(allowed).not.toContain("RETURNED");
        expect(allowed).not.toContain("REJECTED");
        expect(allowed).not.toContain("CANCELLED");
        return Promise.resolve(0);
      });

      // Ebook aktif hanya returnedAt: null dan expiresAt > now
      (prisma.ebookLoan.count as jest.Mock).mockImplementation(({ where }) => {
        expect(where?.returnedAt).toBeNull();
        expect(where?.expiresAt).toHaveProperty("gt");
        return Promise.resolve(0);
      });

      const stats = await getUserActiveLoans("user-2");
      expect(stats.physicalActive).toBe(0);
      expect(stats.ebookActive).toBe(0);
    });

    it("12: Menangani userId kosong dengan aman tanpa query database", async () => {
      const stats = await getUserActiveLoans("");
      expect(stats).toEqual({ physicalActive: 0, ebookActive: 0 });
      expect(prisma.borrowRecord.count).not.toHaveBeenCalled();
      expect(prisma.ebookLoan.count).not.toHaveBeenCalled();
    });
  });

  describe("getUserHistoryTotals helper (Total Riwayat Siswa)", () => {
    it("menjumlahkan riwayat buku fisik dan ebook tanpa hitung ganda", async () => {
      (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(4);
      (prisma.ebookLoan.count as jest.Mock).mockResolvedValue(6);

      const totals = await getUserHistoryTotals("student-1");

      // 4 + 6 = 10; bukan 20 (tidak ada hitung ganda) dan bukan 4 saja.
      expect(totals).toEqual({ physicalTotal: 4, ebookTotal: 6, total: 10 });
      expect(prisma.borrowRecord.count).toHaveBeenCalledWith({
        where: { userId: "student-1" },
      });
      expect(prisma.ebookLoan.count).toHaveBeenCalledWith({
        where: { userId: "student-1" },
      });
    });

    it("hanya menghitung userId yang diminta dan aman untuk id kosong", async () => {
      (prisma.borrowRecord.count as jest.Mock).mockImplementation(({ where }) =>
        Promise.resolve(where.userId === "student-1" ? 2 : 99)
      );
      (prisma.ebookLoan.count as jest.Mock).mockImplementation(({ where }) =>
        Promise.resolve(where.userId === "student-1" ? 3 : 99)
      );

      const totals = await getUserHistoryTotals("student-1");
      expect(totals).toEqual({ physicalTotal: 2, ebookTotal: 3, total: 5 });

      jest.clearAllMocks();
      const empty = await getUserHistoryTotals("");
      expect(empty).toEqual({ physicalTotal: 0, ebookTotal: 0, total: 0 });
      expect(prisma.borrowRecord.count).not.toHaveBeenCalled();
      expect(prisma.ebookLoan.count).not.toHaveBeenCalled();
    });
  });

  describe("Dashboard Siswa (StudentPage)", () => {
    it("3: Dashboard siswa hanya menghitung peminjaman milik siswa yang login", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "student-1", name: "Budi Santoso", role: "STUDENT" },
      });

      (prisma.borrowRecord.count as jest.Mock).mockImplementation(({ where }) => {
        // Cek bahwa semua filter menggunakan userId siswa login
        if (where?.userId === "student-1") {
          if (where?.dueDate) return Promise.resolve(1); // late
          if (where?.status) return Promise.resolve(2); // active physical
          return Promise.resolve(7); // total riwayat buku fisik
        }
        return Promise.resolve(99); // data pengguna lain
      });

      (prisma.ebookLoan.count as jest.Mock).mockImplementation(({ where }) => {
        if (where?.userId === "student-1") {
          if (where?.returnedAt === null) return Promise.resolve(3); // active ebook
          return Promise.resolve(5); // total riwayat ebook
        }
        return Promise.resolve(99);
      });

      render(await StudentPage());

      expect(cardValue("Total Buku Fisik Dipinjam")).toBe("2");
      expect(cardValue("Total Ebook Dipinjam")).toBe("3");
      // 11: Statistik lama yang tidak terkait tetap berfungsi
      expect(cardValue("Terlambat")).toBe("1");
      // 1: Total Riwayat = riwayat buku fisik (7) + riwayat ebook (5).
      expect(cardValue("Total Riwayat")).toBe("12");

      expect(prisma.borrowRecord.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "student-1" }),
        })
      );
      expect(prisma.ebookLoan.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "student-1" }),
        })
      );
      // Total Riwayat mengambil kedua sumber data untuk user yang login.
      expect(prisma.borrowRecord.count).toHaveBeenCalledWith({ where: { userId: "student-1" } });
      expect(prisma.ebookLoan.count).toHaveBeenCalledWith({ where: { userId: "student-1" } });
    });
  });

  describe("Dashboard Guru (TeacherPage)", () => {
    it("4: Dashboard guru hanya menghitung peminjaman milik guru yang login", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "teacher-1", name: "Siti Rahma", role: "TEACHER" },
      });

      (prisma.borrowRecord.count as jest.Mock).mockImplementation(({ where }) => {
        if (where?.userId === "teacher-1") return Promise.resolve(4);
        return Promise.resolve(100);
      });

      (prisma.ebookLoan.count as jest.Mock).mockImplementation(({ where }) => {
        if (where?.userId === "teacher-1") return Promise.resolve(2);
        return Promise.resolve(100);
      });

      (prisma.book.findMany as jest.Mock).mockResolvedValue([
        { id: "b1", title: "Buku A" },
        { id: "b2", title: "Buku B" },
      ]);

      render(await TeacherPage());

      expect(cardValue("Total Buku Fisik Dipinjam")).toBe("4");
      expect(cardValue("Total Ebook Dipinjam")).toBe("2");
      // 11: Statistik lama yang tidak terkait tetap berfungsi
      expect(cardValue("Materi Pembelajaran Baru")).toBe("2");
    });
  });

  describe("Dashboard Pustakawan (LibrarianPage)", () => {
    it("4 & 5: Dashboard pustakawan menghitung statistik operasional seluruh perpustakaan, bukan data pribadi", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "librarian-1", name: "Dewi Pustaka", role: "LIBRARIAN" },
      });

      (prisma.book.count as jest.Mock).mockResolvedValue(150); // total koleksi

      (prisma.borrowRecord.count as jest.Mock).mockImplementation(({ where }) => {
        // Pastikan tidak ada filter userId (menghitung seluruh perpustakaan)
        expect(where?.userId).toBeUndefined();

        if (where?.status === "REQUESTED") {
          return Promise.resolve(5); // menunggu persetujuan
        }
        if (where?.dueDate) {
          return Promise.resolve(3); // buku terlambat
        }
        if (where?.status?.in) {
          return Promise.resolve(25); // buku fisik dipinjam seluruh anggota
        }
        return Promise.resolve(0);
      });

      (prisma.ebookLoan.count as jest.Mock).mockImplementation(({ where }) => {
        // Pastikan tidak ada filter userId (menghitung seluruh perpustakaan)
        expect(where?.userId).toBeUndefined();
        expect(where?.returnedAt).toBeNull();
        expect(where?.expiresAt).toHaveProperty("gt");
        return Promise.resolve(14); // total ebook dipinjam seluruh anggota
      });

      render(await LibrarianPage());

      // Metrik operasional seluruh perpustakaan
      expect(cardValue("Total Koleksi")).toBe("150");
      expect(cardValue("Total Buku Fisik Dipinjam")).toBe("25");
      expect(cardValue("Total Ebook Dipinjam")).toBe("14");
      expect(cardValue("Menunggu Persetujuan")).toBe("5");
      expect(cardValue("Buku Terlambat")).toBe("3");
    });

    it("8 & 9: Peminjaman fisik atau ebook yang sudah kembali / kedaluwarsa tidak dihitung aktif di dashboard pustakawan", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "librarian-1", role: "LIBRARIAN" },
      });

      (prisma.book.count as jest.Mock).mockResolvedValue(0);
      (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
      (prisma.ebookLoan.count as jest.Mock).mockResolvedValue(0);

      render(await LibrarianPage());

      expect(cardValue("Total Koleksi")).toBe("0");
      expect(cardValue("Total Buku Fisik Dipinjam")).toBe("0");
      expect(cardValue("Total Ebook Dipinjam")).toBe("0");
      expect(cardValue("Menunggu Persetujuan")).toBe("0");
      expect(cardValue("Buku Terlambat")).toBe("0");
    });
  });
});
