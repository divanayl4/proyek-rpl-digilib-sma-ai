import {
  READING_ACTIVITY_STATUS,
  getReadingActivityStatus,
  getReadingIdleCutoff,
  readingActivityStatusLabel,
  validateReadingPage,
} from "@/lib/config/reading";
import {
  buildReadingWhere,
  readingStatusWhere,
  resolveReadingPeriod,
} from "@/lib/ebook-reading";

const NOW = new Date("2026-10-22T04:00:00.000Z");

describe("status aktivitas membaca", () => {
  it("OPENED hanya bila sesi baru dibuka dan masih dalam jendela idle", () => {
    expect(
      getReadingActivityStatus(
        {
          lastActivityAt: new Date(NOW.getTime() - 5 * 60 * 1000),
          activityCount: 1,
          endedAt: null,
        },
        NOW
      )
    ).toBe(READING_ACTIVITY_STATUS.OPENED);
  });

  it("ACTIVE bila ada aktivitas lanjutan dalam 30 menit", () => {
    expect(
      getReadingActivityStatus(
        {
          lastActivityAt: new Date(NOW.getTime() - 10 * 60 * 1000),
          activityCount: 2,
          endedAt: null,
        },
        NOW
      )
    ).toBe(READING_ACTIVITY_STATUS.ACTIVE);
  });

  it("menjadi INACTIVE setelah melewati batas idle 30 menit", () => {
    const cutoff = getReadingIdleCutoff(NOW);
    expect(cutoff.toISOString()).toBe("2026-10-22T03:30:00.000Z");
    expect(
      getReadingActivityStatus(
        {
          lastActivityAt: new Date(NOW.getTime() - 30 * 60 * 1000 - 1),
          activityCount: 5,
          endedAt: null,
        },
        NOW
      )
    ).toBe(READING_ACTIVITY_STATUS.INACTIVE);
  });

  it("INACTIVE bila sesi sudah ditutup walau baru saja aktif", () => {
    expect(
      getReadingActivityStatus(
        {
          lastActivityAt: new Date(NOW.getTime() - 1000),
          activityCount: 3,
          endedAt: new Date(NOW.getTime() - 500),
        },
        NOW
      )
    ).toBe(READING_ACTIVITY_STATUS.INACTIVE);
  });

  it("UNKNOWN bila tidak ada sesi", () => {
    expect(getReadingActivityStatus(null, NOW)).toBe(
      READING_ACTIVITY_STATUS.UNKNOWN
    );
    expect(readingActivityStatusLabel(READING_ACTIVITY_STATUS.UNKNOWN)).toBe(
      "Belum ada data"
    );
  });
});

describe("validasi halaman/progres", () => {
  it("menghitung progres valid dan mengurung 0-100", () => {
    expect(validateReadingPage(50, 100)).toEqual({
      ok: true,
      lastPage: 50,
      progressPercent: 50,
    });
    expect(validateReadingPage(100, 100)).toEqual({
      ok: true,
      lastPage: 100,
      progressPercent: 100,
    });
    expect(validateReadingPage(1, 3)).toEqual({
      ok: true,
      lastPage: 1,
      progressPercent: 33.3,
    });
  });

  it("tidak mengarang progres bila pageCount tidak tersedia", () => {
    expect(validateReadingPage(12, null)).toEqual({
      ok: true,
      lastPage: 12,
      progressPercent: null,
    });
  });

  it.each([0, -1, 1.5, "abc", 101])(
    "menolak halaman tidak valid: %p",
    (page) => {
      expect(validateReadingPage(page, 100).ok).toBe(false);
    }
  );

  it("menerima nilai kosong sebagai tidak ada laporan halaman", () => {
    expect(validateReadingPage(undefined, 100)).toEqual({
      ok: true,
      lastPage: null,
      progressPercent: null,
    });
  });
});

describe("predikat status untuk filter database", () => {
  it("ACTIVE memakai cutoff idle dan activityCount > 1", () => {
    expect(readingStatusWhere(READING_ACTIVITY_STATUS.ACTIVE, NOW)).toEqual({
      endedAt: null,
      lastActivityAt: { gt: getReadingIdleCutoff(NOW) },
      activityCount: { gt: 1 },
    });
  });

  it("OPENED memakai activityCount <= 1", () => {
    expect(readingStatusWhere(READING_ACTIVITY_STATUS.OPENED, NOW)).toEqual({
      endedAt: null,
      lastActivityAt: { gt: getReadingIdleCutoff(NOW) },
      activityCount: { lte: 1 },
    });
  });

  it("INACTIVE mencakup sesi tertutup atau melewati cutoff", () => {
    expect(readingStatusWhere(READING_ACTIVITY_STATUS.INACTIVE, NOW)).toEqual({
      OR: [
        { endedAt: { not: null } },
        { lastActivityAt: { lte: getReadingIdleCutoff(NOW) } },
      ],
    });
  });

  it("search/status/periode digabung tanpa saling menimpa", () => {
    const where = buildReadingWhere(
      {
        search: "Budi",
        status: READING_ACTIVITY_STATUS.ACTIVE,
        start: new Date("2026-10-01T00:00:00.000Z"),
        end: new Date("2026-11-01T00:00:00.000Z"),
      },
      NOW
    );
    expect(where.AND).toHaveLength(3);
    expect(where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ OR: expect.any(Array) }),
        expect.objectContaining({ activityCount: { gt: 1 } }),
        expect.objectContaining({
          lastActivityAt: {
            gte: new Date("2026-10-01T00:00:00.000Z"),
            lt: new Date("2026-11-01T00:00:00.000Z"),
          },
        }),
      ])
    );
  });
});

describe("periode aktivitas", () => {
  it("menghitung periode bulan ini dengan batas Asia/Jakarta", () => {
    const period = resolveReadingPeriod("this_month", NOW);
    expect(period.label).toBe("bulan ini");
    expect(period.start?.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(period.end?.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("periode all tidak membatasi tanggal", () => {
    const period = resolveReadingPeriod("all", NOW);
    expect(period.start).toBeUndefined();
    expect(period.end).toBeUndefined();
  });
});
