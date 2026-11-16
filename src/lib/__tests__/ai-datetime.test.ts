/**
 * AI Chat — Utilitas tanggal/waktu zona Asia/Jakarta.
 *
 * Timestamp database adalah UTC. Seluruh pertanyaan faktual ("hari ini",
 * "18 Oktober") harus dibandingkan & ditampilkan memakai zona Asia/Jakarta
 * (UT+7) agar transaksi tidak terlewat atau jatuh ke hari yang salah.
 */

import {
  extractPartialDay,
  formatWibDate,
  formatWibDateLong,
  formatWibDateTime,
  formatWibTime,
  jakartaDayRange,
  jakartaMonthRange,
  jakartaParts,
  jakartaRelativeRange,
  jakartaTodayRange,
  jakartaYearRange,
  resolveJakartaDateRange,
  resolveJakartaPeriod,
} from "@/lib/ai/datetime";

describe("jakartaParts / formatter WIB", () => {
  it("mengubah instant UTC menjadi komponen waktu Jakarta (+7 jam)", () => {
    // 2026-10-18T03:55:04Z == 2026-10-18 10:55 WIB
    const instant = new Date("2026-10-18T03:55:04.191Z");
    expect(jakartaParts(instant)).toMatchObject({
      year: 2026,
      month: 10,
      day: 18,
      hour: 10,
      minute: 55,
    });
    expect(formatWibDate(instant)).toBe("2026-10-18");
    expect(formatWibTime(instant)).toBe("10:55");
    expect(formatWibDateTime(instant)).toBe("2026-10-18 10:55 WIB");
    expect(formatWibDateLong(instant)).toBe("18 Oktober 2026");
  });

  it("memetakan tengah malam UTC ke pagi Jakarta (tanggal lokal berbeda)", () => {
    const instant = new Date("2026-10-17T17:00:00.000Z");
    // 17:00Z + 7 jam = 00:00 tanggal 18 WIB
    expect(formatWibDate(instant)).toBe("2026-10-18");
    expect(formatWibTime(instant)).toBe("00:00");
  });

  it("menggunakan jam 00-23 (bukan 12 jam)", () => {
    expect(formatWibTime(new Date("2026-10-18T16:30:00.000Z"))).toBe("23:30");
    expect(formatWibTime(new Date("2026-10-18T17:30:00.000Z"))).toBe("00:30");
  });
});

describe("jakartaDayRange", () => {
  it("menghasilkan rentang [tengah malam lokal, tengah malam berikutnya)", () => {
    const { start, end } = jakartaDayRange(2026, 10, 18);
    expect(start.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-18T17:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("jakartaTodayRange / jakartaRelativeRange", () => {
  it("menghitung 'hari ini' menurut Jakarta, bukan UTC", () => {
    // 2026-10-18T16:30:00Z masih 18 Oktober di Jakarta (23:30 WIB).
    const range = jakartaTodayRange(new Date("2026-10-18T16:30:00.000Z"));
    expect(range.key).toBe("2026-10-18");
    expect(range.start.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-18T17:00:00.000Z");
  });

  it("menghitung 'kemarin' dengan offset satu hari lokal", () => {
    const range = jakartaRelativeRange(-1, new Date("2026-10-18T04:00:00.000Z"));
    expect(range.key).toBe("2026-10-17");
    expect(range.label).toBe("17 Oktober 2026");
  });
});

describe("resolveJakartaDateRange", () => {
  const now = new Date("2026-10-18T04:00:00.000Z");

  it("memahami 'hari ini'", () => {
    expect(resolveJakartaDateRange("siapa yang meminjam hari ini", now)?.key).toBe("2026-10-18");
  });

  it("memahami 'kemarin'", () => {
    expect(resolveJakartaDateRange("siapa yang meminjam kemarin", now)?.key).toBe("2026-10-17");
  });

  it("memahami 'tanggal 18 Oktober'", () => {
    const range = resolveJakartaDateRange("siapa yang meminjam buku pada tanggal 18 Oktober", now);
    expect(range?.key).toBe("2026-10-18");
    expect(range?.label).toBe("18 Oktober 2026");
  });

  it("memahami tanggal ISO YYYY-MM-DD", () => {
    expect(resolveJakartaDateRange("transaksi 2026-10-15", now)?.key).toBe("2026-10-15");
  });

  it("memahami tanggal numerik 18/10/2026", () => {
    expect(resolveJakartaDateRange("peminjaman 18/10/2026", now)?.key).toBe("2026-10-18");
  });

  it("mengembalikan null untuk tanggal tanpa bulan/tahun", () => {
    expect(resolveJakartaDateRange("siapa yang meminjam pada tanggal 18", now)).toBeNull();
  });

  it("menolak tanggal yang tidak nyata (31 Februari)", () => {
    expect(resolveJakartaDateRange("transaksi 31/02/2026", now)).toBeNull();
  });

  it("mengembalikan null bila tidak ada tanggal sama sekali", () => {
    expect(resolveJakartaDateRange("siapa yang sedang meminjam buku", now)).toBeNull();
  });
});

describe("extractPartialDay", () => {
  it("mengambil hari dari 'tanggal 18'", () => {
    expect(extractPartialDay("siapa yang meminjam pada tanggal 18")).toBe(18);
  });

  it("mengembalikan null bila tidak ada hari parsial", () => {
    expect(extractPartialDay("siapa yang meminjam hari ini")).toBeNull();
  });
});

describe("periode Jakarta (bulan/tahun)", () => {
  const now = new Date("2026-10-18T04:00:00.000Z");

  it("jakartaMonthRange memakai batas [awal bulan, awal bulan berikutnya)", () => {
    const { start, end } = jakartaMonthRange(2026, 10);
    expect(start.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(31 * 24 * 60 * 60 * 1000);
  });

  it("jakartaYearRange menangani tahun kabisat", () => {
    const { start, end } = jakartaYearRange(2024);
    expect(start.toISOString()).toBe("2023-12-31T17:00:00.000Z");
    expect(end.toISOString()).toBe("2024-12-31T17:00:00.000Z");
  });

  it("memahami 'bulan ini' dan 'bulan lalu'", () => {
    const thisMonth = resolveJakartaPeriod("berapa pengembalian bulan ini", now);
    expect(thisMonth?.key).toBe("2026-10");
    expect(thisMonth?.start.toISOString()).toBe("2026-09-30T17:00:00.000Z");

    const lastMonth = resolveJakartaPeriod("berapa pengembalian bulan lalu", now);
    expect(lastMonth?.key).toBe("2026-09");
    expect(lastMonth?.start.toISOString()).toBe("2026-08-31T17:00:00.000Z");
  });

  it("memahami 'tahun ini' dan tahun eksplisit", () => {
    const thisYear = resolveJakartaPeriod("transaksi tahun ini", now);
    expect(thisYear?.key).toBe("2026");
    expect(thisYear?.granularity).toBe("year");

    const explicit = resolveJakartaPeriod("transaksi tahun 2025", now);
    expect(explicit?.key).toBe("2025");
    expect(explicit?.start.toISOString()).toBe("2024-12-31T17:00:00.000Z");
  });

  it("memahami nama bulan dengan dan tanpa tahun", () => {
    expect(resolveJakartaPeriod("pengembalian Oktober 2025", now)?.key).toBe("2025-10");
    expect(resolveJakartaPeriod("pengembalian bulan Oktober", now)?.key).toBe("2026-10");
  });

  it("tidak salah mengartikan tanggal lengkap sebagai satu bulan", () => {
    expect(resolveJakartaPeriod("transaksi 18 Oktober 2026", now)).toBeNull();
  });
});
