import { prisma } from "@/lib/prisma";
import { getTransactionStats } from "@/lib/transactionStats";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    borrowRecord: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    ebookLoan: {
      count: jest.fn(),
    },
  },
}));

const borrowCount = prisma.borrowRecord.count as jest.Mock;
const borrowGroupBy = prisma.borrowRecord.groupBy as jest.Mock;
const ebookCount = prisma.ebookLoan.count as jest.Mock;

const PAST = new Date(Date.now() - 3 * 86400000);

function physicalGroups(overrides: Record<string, number> = {}) {
  const counts: Record<string, number> = {
    REQUESTED: 0,
    BORROWED: 0,
    OVERDUE: 0,
    RETURNED: 0,
    CANCELLED: 0,
    REJECTED: 0,
    ...overrides,
  };

  return Object.entries(counts).map(([status, count]) => ({
    status,
    _count: { _all: count },
  }));
}

beforeEach(() => {
  jest.resetAllMocks();
  borrowCount.mockResolvedValue(0);
  borrowGroupBy.mockResolvedValue([]);
  ebookCount.mockResolvedValue(0);
});

describe("getTransactionStats - definisi metrik bersama", () => {
  it("1. statistik buku fisik hanya mengambil data BorrowRecord", async () => {
    borrowCount.mockResolvedValueOnce(19).mockResolvedValueOnce(1);
    borrowGroupBy.mockResolvedValue(
      physicalGroups({ BORROWED: 2, RETURNED: 17 })
    );

    const stats = await getTransactionStats({ includeEbook: false });

    expect(stats.physicalTotal).toBe(19);
    expect(stats.physicalActive).toBe(2);
    expect(stats.physicalBorrowedOnTime).toBe(1);
    expect(stats.physicalOverdue).toBe(1);
    expect(ebookCount).not.toHaveBeenCalled();
  });

  it("2. statistik ebook hanya mengambil data EbookLoan", async () => {
    ebookCount
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    const stats = await getTransactionStats({ includePhysical: false });

    expect(stats.ebookTotal).toBe(14);
    expect(stats.ebookActive).toBe(9);
    expect(stats.ebookExpired).toBe(3);
    expect(stats.ebookReturned).toBe(2);
    expect(borrowCount).not.toHaveBeenCalled();
    expect(borrowGroupBy).not.toHaveBeenCalled();
  });

  it("3. total keseluruhan adalah penjumlahan sumber fisik dan ebook", async () => {
    borrowCount.mockResolvedValueOnce(19).mockResolvedValueOnce(0);
    borrowGroupBy.mockResolvedValue(physicalGroups({ BORROWED: 2, RETURNED: 17 }));
    ebookCount
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    const stats = await getTransactionStats();

    expect(stats.physicalTotal).toBe(19);
    expect(stats.ebookTotal).toBe(14);
    expect(stats.total).toBe(33);
  });

  it("4. transaksi tidak dihitung dua kali saat jumlah kedua sumber berbeda", async () => {
    borrowCount.mockResolvedValueOnce(7).mockResolvedValueOnce(0);
    borrowGroupBy.mockResolvedValue(physicalGroups({ RETURNED: 7 }));
    ebookCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const stats = await getTransactionStats();

    expect(stats.total).toBe(10);
    expect(stats.total).not.toBe(14);
    expect(stats.total).not.toBe(21);
  });

  it("5. status aktif dan riwayat tidak tertukar", async () => {
    borrowCount.mockResolvedValueOnce(12).mockResolvedValueOnce(1);
    borrowGroupBy.mockResolvedValue(
      physicalGroups({
        REQUESTED: 1,
        BORROWED: 2,
        OVERDUE: 1,
        RETURNED: 5,
        CANCELLED: 2,
        REJECTED: 1,
      })
    );
    ebookCount
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3);

    const stats = await getTransactionStats();

    expect(stats.physicalRequested).toBe(1);
    expect(stats.physicalActive).toBe(3);
    expect(stats.physicalBorrowedOnTime).toBe(2);
    expect(stats.physicalOverdue).toBe(1);
    expect(stats.physicalReturned).toBe(5);
    expect(stats.physicalCancelled).toBe(2);
    expect(stats.physicalRejected).toBe(1);
    expect(stats.ebookActive).toBe(4);
    expect(stats.ebookExpired).toBe(3);
    expect(stats.ebookReturned).toBe(3);
  });

  it("6. data kosong menghasilkan angka nol yang benar", async () => {
    const stats = await getTransactionStats();

    expect(stats).toEqual({
      total: 0,
      physicalTotal: 0,
      physicalRequested: 0,
      physicalBorrowedOnTime: 0,
      physicalActive: 0,
      physicalOverdue: 0,
      physicalReturned: 0,
      physicalCancelled: 0,
      physicalRejected: 0,
      ebookTotal: 0,
      ebookActive: 0,
      ebookReturned: 0,
      ebookExpired: 0,
    });
  });

  it("7. perubahan status transaksi memperbarui statistik pada pembacaan berikutnya", async () => {
    borrowCount
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    borrowGroupBy
      .mockResolvedValueOnce(physicalGroups({ BORROWED: 5 }))
      .mockResolvedValueOnce(physicalGroups({ RETURNED: 5 }));

    const before = await getTransactionStats({ includeEbook: false });
    const after = await getTransactionStats({ includeEbook: false });

    expect(before.physicalActive).toBe(5);
    expect(before.physicalReturned).toBe(0);
    expect(after.physicalActive).toBe(0);
    expect(after.physicalReturned).toBe(5);
    expect(after.physicalTotal).toBe(5);
  });

  it("8. filter status pemanggil tidak tertimpa oleh filter overdue/ebook aktif", async () => {
    const physicalWhere = { status: "RETURNED" };
    const ebookWhere = { returnedAt: { not: null } };

    await getTransactionStats({ physicalWhere, ebookWhere });

    expect(borrowCount.mock.calls[1][0].where).toEqual({
      AND: [
        physicalWhere,
        {
          status: { in: ["BORROWED", "OVERDUE"] },
          dueDate: { lt: expect.any(Date) },
        },
      ],
    });
    expect(ebookCount.mock.calls[1][0].where).toEqual({
      AND: [
        ebookWhere,
        { returnedAt: null, expiresAt: { gt: expect.any(Date) } },
      ],
    });
  });

  it("9. status BORROWED yang lewat jatuh tempo dihitung aktif sekaligus terlambat", async () => {
    const now = new Date("2026-10-23T00:00:00.000Z");
    borrowCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    borrowGroupBy.mockResolvedValue(
      physicalGroups({ BORROWED: 2, RETURNED: 0 })
    );

    const stats = await getTransactionStats({
      physicalWhere: { dueDate: { lt: PAST } },
      includeEbook: false,
      now,
    });

    expect(stats.physicalActive).toBe(2);
    expect(stats.physicalOverdue).toBe(1);
    expect(stats.physicalBorrowedOnTime).toBe(1);
  });

  it("10. total ebook tidak mencampur status keterlambatan buku fisik", async () => {
    borrowCount.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    borrowGroupBy.mockResolvedValue(
      physicalGroups({ BORROWED: 1, OVERDUE: 1, RETURNED: 2 })
    );
    ebookCount
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3);

    const stats = await getTransactionStats();

    expect(stats.physicalOverdue).toBe(1);
    expect(stats.ebookActive).toBe(2);
    expect(stats.ebookExpired).toBe(1);
    expect(stats.ebookReturned).toBe(3);
    expect(stats.ebookTotal).toBe(6);
  });
});
