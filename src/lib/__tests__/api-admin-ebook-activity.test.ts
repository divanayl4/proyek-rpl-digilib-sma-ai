const mockGetServerSession = jest.fn();
const mockList = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/ebook-reading", () => ({
  listReadingActivity: (...args: unknown[]) => mockList(...args),
  isReadingPeriodKey: (value: string | null | undefined) =>
    ["today", "7d", "30d", "this_month", "last_month", "this_year", "all"].includes(
      value ?? ""
    ),
  resolveReadingPeriod: (value: string) => ({
    key: value,
    label: value === "this_month" ? "bulan ini" : "30 hari terakhir",
    start: new Date("2026-10-01T00:00:00.000Z"),
    end: new Date("2026-10-22T00:00:00.000Z"),
  }),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/ebook-activity/route";

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/admin/ebook-activity${query ? `?${query}` : ""}`
  );
}

function signIn(role: string) {
  mockGetServerSession.mockResolvedValue({
    user: { id: "session-user", role },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    summary: {
      totalSessions: 0,
      uniqueUsers: 0,
      uniqueBooks: 0,
      activeSessions: 0,
      openedSessions: 0,
      inactiveSessions: 0,
    },
    periodLabel: "30 hari terakhir",
    pageTrackingSupported: false,
  });
});

describe("GET /api/admin/ebook-activity", () => {
  it("menolak request tanpa sesi", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it.each(["LIBRARIAN", "TEACHER", "STUDENT", "STAFF"])(
    "menolak role %s sebelum mengambil data",
    async (role) => {
      signIn(role);

      const res = await GET(request());

      expect(res.status).toBe(403);
      expect(mockList).not.toHaveBeenCalled();
    }
  );

  it("meneruskan pencarian, status, periode, urutan, dan pagination untuk ADMIN", async () => {
    signIn("ADMIN");

    const res = await GET(
      request(
        "page=2&pageSize=10&search=Budi&status=active&period=this_month&sort=lastActivityAt_asc"
      )
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.period.key).toBe("this_month");
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 10,
        sort: "lastActivityAt_asc",
        filters: expect.objectContaining({
          search: "Budi",
          status: "ACTIVE",
          periodLabel: "bulan ini",
          start: new Date("2026-10-01T00:00:00.000Z"),
          end: new Date("2026-10-22T00:00:00.000Z"),
        }),
      })
    );
  });

  it("menggunakan default 30 hari dan tanpa status bila status ALL", async () => {
    signIn("ADMIN");

    await GET(request("status=ALL"));

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        filters: expect.objectContaining({
          status: null,
          periodLabel: "30 hari terakhir",
        }),
      })
    );
  });

  it("menolak status aktivitas yang tidak dikenal", async () => {
    signIn("ADMIN");

    const res = await GET(request("status=SEDANG_BACA"));

    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("menolak periode yang tidak dikenal", async () => {
    signIn("ADMIN");

    const res = await GET(request("period=tahun_lalu_sekali"));

    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("membatasi pageSize maksimal 100", async () => {
    signIn("ADMIN");

    await GET(request("pageSize=999"));

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 100 })
    );
  });
});
