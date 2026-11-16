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

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: jest.fn() },
    book: { count: jest.fn() },
    borrowRecord: { count: jest.fn(), groupBy: jest.fn() },
    ebookLoan: { count: jest.fn() },
  },
}));

import AdminPage from "@/app/admin/page";
import { prisma } from "@/lib/prisma";

function cardValue(label: string): string | null | undefined {
  const labelElement = screen.getByText(label);
  return labelElement.parentElement?.querySelector(".stat-card__value")?.textContent;
}

describe("Dasbor Administrator - metrik koleksi dan transaksi", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("menampilkan total buku fisik dan total ebook secara terpisah bersama metrik transaksi", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    });
    (prisma.user.count as jest.Mock).mockResolvedValue(50);
    (prisma.book.count as jest.Mock).mockImplementation(({ where }) => {
      if (where?.format === "PHYSICAL") return Promise.resolve(12);
      if (where?.format === "EBOOK") return Promise.resolve(8);
      return Promise.resolve(0);
    });
    (prisma.borrowRecord.count as jest.Mock)
      .mockResolvedValueOnce(19) // total fisik
      .mockResolvedValueOnce(0); // terlambat
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([
      { status: "BORROWED", _count: { _all: 2 } },
      { status: "RETURNED", _count: { _all: 17 } },
    ]);
    (prisma.ebookLoan.count as jest.Mock)
      .mockResolvedValueOnce(14) // total ebook
      .mockResolvedValueOnce(9) // aktif
      .mockResolvedValueOnce(3) // kedaluwarsa
      .mockResolvedValueOnce(2); // dikembalikan

    render(await AdminPage());

    expect(cardValue("Total Pengguna")).toBe("50");
    expect(cardValue("Total Buku Fisik")).toBe("12");
    expect(cardValue("Total Ebook")).toBe("8");
    expect(cardValue("Total Transaksi Buku Fisik")).toBe("19");
    expect(cardValue("Total Transaksi Ebook")).toBe("14");
    expect(cardValue("Total Transaksi Keseluruhan")).toBe("33");
    expect(cardValue("Peminjaman Buku Fisik Aktif")).toBe("2");
    expect(cardValue("Sesi Ebook Aktif")).toBe("9");

    expect(prisma.book.count).toHaveBeenCalledWith({
      where: { archivedAt: null, format: "PHYSICAL" },
    });
    expect(prisma.book.count).toHaveBeenCalledWith({
      where: { archivedAt: null, format: "EBOOK" },
    });
  });

  it("total koleksi tidak berubah hanya karena jumlah transaksi bertambah", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    });
    (prisma.user.count as jest.Mock).mockResolvedValue(50);
    (prisma.book.count as jest.Mock).mockImplementation(({ where }) => {
      if (where?.format === "PHYSICAL") return Promise.resolve(12);
      if (where?.format === "EBOOK") return Promise.resolve(8);
      return Promise.resolve(0);
    });
    // Transaksi berlipat ganda
    (prisma.borrowRecord.count as jest.Mock)
      .mockResolvedValueOnce(100) // total fisik
      .mockResolvedValueOnce(5); // terlambat
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([
      { status: "BORROWED", _count: { _all: 20 } },
      { status: "RETURNED", _count: { _all: 80 } },
    ]);
    (prisma.ebookLoan.count as jest.Mock)
      .mockResolvedValueOnce(80) // total ebook
      .mockResolvedValueOnce(30) // aktif
      .mockResolvedValueOnce(20) // kedaluwarsa
      .mockResolvedValueOnce(30); // dikembalikan

    render(await AdminPage());

    // Koleksi tetap 12 dan 8 meski transaksi bertambah
    expect(cardValue("Total Buku Fisik")).toBe("12");
    expect(cardValue("Total Ebook")).toBe("8");
    expect(cardValue("Total Transaksi Buku Fisik")).toBe("100");
    expect(cardValue("Total Transaksi Ebook")).toBe("80");
    expect(cardValue("Total Transaksi Keseluruhan")).toBe("180");
  });
});
