/**
 * AI Chat — Statistik operasional.
 *
 * Definisi angka harus sama dengan halaman laporan/dashboard resmi:
 * count/aggregate terpisah (tanpa JOIN relasi), periode Asia/Jakarta, dan
 * pembedaan tegas antara transaksi, status saat ini, serta denda.
 */

const mockBorrowCount = jest.fn();
const mockBorrowGroupBy = jest.fn();
const mockBorrowAggregate = jest.fn();
const mockFineAggregate = jest.fn();
const mockEbookCount = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    borrowRecord: {
      count: mockBorrowCount,
      groupBy: mockBorrowGroupBy,
      aggregate: mockBorrowAggregate,
    },
    finePayment: { aggregate: mockFineAggregate },
    ebookLoan: { count: mockEbookCount },
  },
}));

import {
  detectRequestedMetrics,
  getOperationalStats,
  resolveStatsPeriod,
  resolveStatsPeriodInput,
  resolveTransactionFormat,
} from "@/lib/ai/operationalStats";
import { jakartaMonthRange } from "@/lib/ai/datetime";

const NOW = new Date("2026-10-18T04:00:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  mockBorrowCount.mockResolvedValue(0);
  mockBorrowGroupBy.mockResolvedValue([]);
  mockBorrowAggregate.mockResolvedValue({ _sum: { fineAmount: 0 } });
  mockFineAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockEbookCount.mockResolvedValue(0);
});

describe("resolveStatsPeriod()", () => {
  it("memprioritaskan tanggal lengkap sebagai satu hari", () => {
    const period = resolveStatsPeriod("transaksi 18 Oktober 2026", NOW);
    expect(period?.granularity).toBe("day");
    expect(period?.key).toBe("2026-10-18");
  });

  it("memakai rentang bulan penuh untuk 'bulan ini'", () => {
    const period = resolveStatsPeriod("berapa pengembalian bulan ini", NOW);
    const expected = jakartaMonthRange(2026, 10);
    expect(period?.granularity).toBe("month");
    expect(period?.start.toISOString()).toBe(expected.start.toISOString());
    expect(period?.end.toISOString()).toBe(expected.end.toISOString());
  });

  it("memahami input tool YYYY-MM", () => {
    const period = resolveStatsPeriodInput("2026-10", NOW);
    expect(period?.granularity).toBe("month");
    expect(period?.key).toBe("2026-10");
  });

  it("memahami input tool tahun eksplisit", () => {
    const period = resolveStatsPeriodInput("2025", NOW);
    expect(period?.granularity).toBe("year");
    expect(period?.key).toBe("2025");
  });

  it("mengembalikan null bila tidak ada periode", () => {
    expect(resolveStatsPeriod("berapa total transaksi", NOW)).toBeNull();
  });
});

describe("resolveTransactionFormat()", () => {
  it("pertanyaan ebook hanya memakai format EBOOK", () => {
    expect(resolveTransactionFormat("Berapa total transaksi ebook?")).toBe("EBOOK");
    expect(
      resolveTransactionFormat("Berapa transaksi peminjaman e-book?")
    ).toBe("EBOOK");
    expect(
      resolveTransactionFormat("Berapa ebook yang pernah dipinjam?")
    ).toBe("EBOOK");
    expect(
      resolveTransactionFormat("Berapa transaksi ebook yang sudah dikembalikan?")
    ).toBe("EBOOK");
  });

  it("pertanyaan buku fisik spesifik memilih PHYSICAL", () => {
    expect(
      resolveTransactionFormat("Berapa total transaksi buku di perpustakaan?")
    ).toBe("PHYSICAL");
    expect(resolveTransactionFormat("Berapa transaksi peminjaman buku fisik?")).toBe(
      "PHYSICAL"
    );
    expect(resolveTransactionFormat("Berapa total transaksi buku fisik?")).toBe(
      "PHYSICAL"
    );
  });

  it("pertanyaan transaksi keseluruhan/global/perpustakaan memilih ALL", () => {
    expect(resolveTransactionFormat("Berapa total transaksi?")).toBe("ALL");
    expect(resolveTransactionFormat("Berapa total transaksi keseluruhan?")).toBe(
      "ALL"
    );
    expect(resolveTransactionFormat("Berapa total transaksi perpustakaan?")).toBe(
      "ALL"
    );
    expect(resolveTransactionFormat("Berapa jumlah semua transaksi?")).toBe("ALL");
    expect(resolveTransactionFormat("Berapa semua transaksi?")).toBe("ALL");
    expect(resolveTransactionFormat("Berapa seluruh transaksi DigiLib?")).toBe(
      "ALL"
    );
    expect(
      resolveTransactionFormat("Berapa semua transaksi ebook dan buku fisik?")
    ).toBe("ALL");
    expect(
      resolveTransactionFormat("Berapa transaksi buku fisik dan ebook?")
    ).toBe("ALL");
    expect(
      resolveTransactionFormat("Berapa total transaksi fisik dan ebook?")
    ).toBe("ALL");
  });

  it("'semua transaksi ebook' tidak dibelokkan menjadi ALL", () => {
    expect(resolveTransactionFormat("Berapa semua transaksi ebook?")).toBe("EBOOK");
  });

  it("mengikuti format eksplisit hanya bila pertanyaan tidak menyebut format", () => {
    expect(resolveTransactionFormat("Berapa total transaksi?", "EBOOK")).toBe(
      "EBOOK"
    );
    // Isi pertanyaan mengalahkan argumen model.
    expect(resolveTransactionFormat("Berapa transaksi ebook?", "PHYSICAL")).toBe(
      "EBOOK"
    );
  });

  it("follow-up format baru tidak mewarisi format pertanyaan sebelumnya", () => {
    expect(resolveTransactionFormat("Kalau buku fisik?")).toBe("PHYSICAL");
    expect(resolveTransactionFormat("Kalau ebook?")).toBe("EBOOK");
  });
});

describe("detectRequestedMetrics()", () => {
  it("mendeteksi metrik spesifik tanpa menambahkan transaksi generik", () => {
    expect(detectRequestedMetrics("Berapa jumlah pengembalian bulan ini?")).toEqual([
      "RETURNS",
    ]);
    expect(detectRequestedMetrics("Berapa total denda yang belum dibayar?")).toEqual([
      "FINES",
    ]);
    expect(detectRequestedMetrics("Berapa peminjaman yang terlambat?")).toContain(
      "OVERDUE"
    );
  });

  it("memakai ringkasan operasional hanya untuk permintaan statistik umum", () => {
    const metrics = detectRequestedMetrics("Tampilkan statistik perpustakaan");
    expect(metrics).toEqual([
      "BORROWS",
      "ACTIVE",
      "PENDING",
      "OVERDUE",
      "RETURNS",
      "FINES",
    ]);
  });
});

describe("getOperationalStats()", () => {
  it("memfilter peminjaman dan pengembalian memakai tanggal yang berbeda", async () => {
    const period = resolveStatsPeriod("Oktober 2026", NOW)!;

    await getOperationalStats(period, NOW);

    const borrowCountCall = mockBorrowCount.mock.calls.find(
      (call) => call[0].where.borrowDate
    );
    expect(borrowCountCall?.[0].where.borrowDate).toEqual({
      gte: period.start,
      lt: period.end,
    });

    const returnCountCall = mockBorrowCount.mock.calls.find(
      (call) => call[0].where.returnDate
    );
    expect(returnCountCall?.[0].where).toMatchObject({
      status: "RETURNED",
      returnDate: { gte: period.start, lt: period.end },
    });
  });

  it("menghitung status saat ini tanpa filter periode", async () => {
    const period = resolveStatsPeriod("Oktober 2026", NOW)!;

    await getOperationalStats(period, NOW);

    const activeCall = mockBorrowCount.mock.calls.find(
      (call) => call[0].where.status?.in?.includes("BORROWED")
    );
    expect(activeCall?.[0].where.borrowDate).toBeUndefined();

    const pendingCall = mockBorrowCount.mock.calls.find(
      (call) => call[0].where.status === "REQUESTED"
    );
    expect(pendingCall?.[0].where.borrowDate).toBeUndefined();
  });

  it("memfilter transaksi ebook dengan borrowedAt, bukan borrowDate", async () => {
    const period = resolveStatsPeriod("Oktober 2026", NOW)!;

    await getOperationalStats(period, NOW);

    const totalCall = mockEbookCount.mock.calls.find(
      (call) => call[0].where.borrowedAt
    );
    expect(totalCall?.[0].where).toEqual({
      borrowedAt: { gte: period.start, lt: period.end },
    });
    expect(totalCall?.[0].where.borrowDate).toBeUndefined();
  });

  it("menghitung seluruh transaksi ebook tanpa filter saat periode null", async () => {
    await getOperationalStats(null, NOW);

    expect(
      mockEbookCount.mock.calls.some(
        (call) => Object.keys(call[0].where).length === 0
      )
    ).toBe(true);
  });

  it("mengurangi denda dinilai dengan pembayaran dan tidak pernah negatif", async () => {
    mockBorrowAggregate.mockResolvedValue({ _sum: { fineAmount: 5000 } });
    mockFineAggregate.mockResolvedValue({ _sum: { amount: 8000 } });

    const stats = await getOperationalStats(null, NOW);

    expect(stats.fines.assessed).toBe(5000);
    expect(stats.fines.collected).toBe(8000);
    expect(stats.fines.outstanding).toBe(0);
  });

  it("mengembalikan angka 0 yang nyata saat tidak ada data", async () => {
    const stats = await getOperationalStats(null, NOW);
    expect(stats.totalBorrows).toBe(0);
    expect(stats.returns).toBe(0);
    expect(stats.overdueBorrows).toBe(0);
    expect(stats.fines.records).toBe(0);
  });

  it("format EBOOK hanya menjalankan query EbookLoan, tanpa BorrowRecord", async () => {
    mockEbookCount.mockResolvedValue(4);

    const stats = await getOperationalStats(null, NOW, "EBOOK");

    expect(stats.format).toBe("EBOOK");
    expect(stats.physical).toBeNull();
    expect(stats.ebook?.totalLoans).toBe(4);
    expect(mockBorrowCount).not.toHaveBeenCalled();
    expect(mockBorrowGroupBy).not.toHaveBeenCalled();
    expect(mockBorrowAggregate).not.toHaveBeenCalled();
    expect(mockFineAggregate).not.toHaveBeenCalled();
    expect(mockEbookCount).toHaveBeenCalled();

    for (const call of mockEbookCount.mock.calls) {
      expect(call[0].where.borrowDate).toBeUndefined();
      expect(call[0].where.returnDate).toBeUndefined();
    }
  });

  it("format PHYSICAL hanya menjalankan query BorrowRecord, tanpa EbookLoan", async () => {
    mockBorrowCount.mockResolvedValue(9);

    const stats = await getOperationalStats(null, NOW, "PHYSICAL");

    expect(stats.format).toBe("PHYSICAL");
    expect(stats.ebook).toBeNull();
    expect(stats.physical?.totalBorrows).toBe(9);
    expect(stats.ebookLoans).toBe(0);
    expect(mockEbookCount).not.toHaveBeenCalled();
  });

  it("format ALL menjalankan kedua sumber dan tetap terpisah", async () => {
    mockBorrowCount.mockResolvedValue(9);
    mockEbookCount.mockResolvedValue(4);

    const stats = await getOperationalStats(null, NOW, "ALL");

    expect(stats.format).toBe("ALL");
    expect(stats.physical?.totalBorrows).toBe(9);
    expect(stats.ebook?.totalLoans).toBe(4);
    expect(mockBorrowCount).toHaveBeenCalled();
    expect(mockEbookCount).toHaveBeenCalled();
  });

  it("filter status ebook memakai returnedAt/expiresAt, bukan status fisik", async () => {
    const period = resolveStatsPeriod("Oktober 2026", NOW)!;
    mockEbookCount.mockResolvedValue(2);

    await getOperationalStats(period, NOW, "EBOOK");

    expect(
      mockEbookCount.mock.calls.some(
        (call) =>
          call[0].where.returnedAt?.gte?.getTime() === period.start.getTime() &&
          call[0].where.returnedAt?.lt?.getTime() === period.end.getTime()
      )
    ).toBe(true);
    expect(
      mockEbookCount.mock.calls.some(
        (call) =>
          call[0].where.returnedAt === null &&
          call[0].where.expiresAt?.gt?.getTime() === NOW.getTime()
      )
    ).toBe(true);
    expect(
      mockEbookCount.mock.calls.some(
        (call) =>
          call[0].where.returnedAt === null &&
          call[0].where.expiresAt?.lte?.getTime() === NOW.getTime()
      )
    ).toBe(true);
  });

  it("format EBOOK kosong tidak mengambil angka buku fisik sebagai pengganti", async () => {
    mockBorrowCount.mockResolvedValue(99);
    mockEbookCount.mockResolvedValue(0);

    const stats = await getOperationalStats(null, NOW, "EBOOK");

    expect(stats.ebook?.totalLoans).toBe(0);
    expect(stats.totalBorrows).toBe(0);
    expect(stats.physical).toBeNull();
  });

  it("judul yang sama tidak membuat query format tercampur", async () => {
    const format = resolveTransactionFormat(
      "Berapa transaksi ebook berjudul Laskar Pelangi?"
    );
    expect(format).toBe("EBOOK");

    await getOperationalStats(null, NOW, format);

    expect(mockBorrowCount).not.toHaveBeenCalled();
    expect(mockEbookCount).toHaveBeenCalled();
  });
});
