/**
 * Authorization, filter, pagination, and summary tests for
 * GET /api/admin/ebook-access-history.
 *
 * The endpoint is deliberately separate from reading sessions: rows and
 * summaries come only from EbookLoan and must never gain reading-activity
 * fields such as lastPage, progressPercent, or activityCount.
 */

const mockGetServerSession = jest.fn();
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockGroupBy = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    ebookLoan: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
  },
}));

const PERIOD_START = new Date("2026-10-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-10-22T00:00:00.000Z");

jest.mock("@/lib/ebook-reading", () => ({
  isReadingPeriodKey: (value: string | null | undefined) =>
    [
      "today",
      "7d",
      "30d",
      "this_month",
      "last_month",
      "this_year",
      "all",
    ].includes(value ?? ""),
  resolveReadingPeriod: (value: string) => ({
    key: value,
    label: value === "all" ? "seluruh periode" : "30 hari terakhir",
    start: value === "all" ? undefined : PERIOD_START,
    end: value === "all" ? undefined : PERIOD_END,
  }),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/ebook-access-history/route";

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/admin/ebook-access-history${query ? `?${query}` : ""}`
  );
}

function signIn(role: string | null) {
  mockGetServerSession.mockResolvedValue(
    role ? { user: { id: "session-user", role } } : null
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockReset();
  mockFindMany.mockReset().mockResolvedValue([]);
  mockCount.mockReset().mockResolvedValue(0);
  mockGroupBy.mockReset().mockResolvedValue([]);
});

describe("GET /api/admin/ebook-access-history — otorisasi", () => {
  it("menolak request tanpa sesi (401) tanpa query data", async () => {
    signIn(null);

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  it.each(["LIBRARIAN", "STUDENT", "TEACHER", "STAFF"])(
    "menolak role %s (403) tanpa query data",
    async (role) => {
      signIn(role);

      const res = await GET(request());

      expect(res.status).toBe(403);
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockCount).not.toHaveBeenCalled();
      expect(mockGroupBy).not.toHaveBeenCalled();
    }
  );
});

describe("GET /api/admin/ebook-access-history — data EbookLoan", () => {
  beforeEach(() => signIn("ADMIN"));

  it("mengembalikan riwayat dengan penanda sumber dan tanpa kolom aktivitas membaca", async () => {
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockFindMany.mockResolvedValue([
      {
        id: "loan-1",
        borrowedAt: new Date("2026-10-20T01:00:00.000Z"),
        expiresAt: futureExpiry,
        returnedAt: null,
        status: "ACTIVE",
        user: {
          id: "u1",
          name: "Siti",
          role: "STUDENT",
          class: "XII IPA 1",
          identityNumber: "2024001",
        },
        book: {
          id: "b1",
          title: "Ebook Lama",
          author: "Penulis Lama",
          format: "EBOOK",
          archivedAt: new Date("2026-10-01T00:00:00.000Z"),
        },
      },
      {
        id: "loan-2",
        borrowedAt: new Date("2026-10-10T01:00:00.000Z"),
        expiresAt: new Date("2026-10-15T01:00:00.000Z"),
        returnedAt: new Date("2026-10-12T01:00:00.000Z"),
        status: "RETURNED",
        user: {
          id: "u2",
          name: "Pak Guru",
          role: "TEACHER",
          class: null,
          identityNumber: "1987001",
        },
        book: {
          id: "b2",
          title: "Ebook Aktif",
          author: "Penulis Baru",
          format: "EBOOK",
          archivedAt: null,
        },
      },
    ]);
    mockCount
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(7);
    mockGroupBy
      .mockResolvedValueOnce([{ userId: "u1" }, { userId: "u2" }])
      .mockResolvedValueOnce([{ bookId: "b1" }]);

    const res = await GET(request("period=all"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("EbookLoan");
    expect(body.readingEvidence).toBe(false);
    expect(body.notice).toMatch(/bukan bukti/i);
    expect(body.notice).toMatch(/dibuka atau dibaca/i);
    expect(body.summary).toEqual({
      totalLoans: 14,
      uniqueUsers: 2,
      uniqueBooks: 1,
      activeLoans: 1,
      returnedLoans: 6,
      expiredLoans: 7,
    });
    expect(body.summary).not.toHaveProperty("totalSessions");
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({
      id: "loan-1",
      status: "ACTIVE",
      book: {
        title: "Ebook Lama",
        isArchived: true,
      },
    });
    expect(body.rows[1]).toMatchObject({
      id: "loan-2",
      status: "RETURNED",
      book: {
        title: "Ebook Aktif",
        isArchived: false,
      },
    });
    for (const row of body.rows) {
      expect(row).not.toHaveProperty("lastPage");
      expect(row).not.toHaveProperty("progressPercent");
      expect(row).not.toHaveProperty("activityCount");
      expect(row).not.toHaveProperty("firstOpenedAt");
    }
  });

  it("meneruskan pencarian, status, periode, dan pagination ke query EbookLoan", async () => {
    await GET(
      request(
        "page=2&pageSize=10&search=Budi&status=active&period=all"
      )
    );

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: { borrowedAt: "desc" },
      })
    );
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual({
      OR: [
        { user: { name: { contains: "Budi" } } },
        { user: { class: { contains: "Budi" } } },
        { user: { identityNumber: { contains: "Budi" } } },
        { book: { title: { contains: "Budi" } } },
        { book: { author: { contains: "Budi" } } },
      ],
    });
    expect(where.AND[1]).toEqual({
      returnedAt: null,
      expiresAt: { gt: expect.any(Date) },
    });
  });

  it("menggunakan default 30 hari dan membatasi pageSize maksimal 100", async () => {
    await GET(request("pageSize=999"));

    const args = mockFindMany.mock.calls[0][0];
    expect(args.where).toEqual({
      borrowedAt: { gte: PERIOD_START, lt: PERIOD_END },
    });
    expect(args.take).toBe(100);
    expect(args.skip).toBe(0);
  });

  it("menolak status dan periode yang tidak dikenal tanpa query data", async () => {
    const invalidStatus = await GET(request("status=SEDANG_DIBACA"));
    expect(invalidStatus.status).toBe(400);

    const invalidPeriod = await GET(request("period=tahun_lalu_sekali"));
    expect(invalidPeriod.status).toBe(400);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockGroupBy).not.toHaveBeenCalled();
  });
});
