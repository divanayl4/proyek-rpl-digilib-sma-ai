/**
 * @jest-environment jsdom
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

jest.mock("@/components/layout/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AdminEbookActivityPage from "@/app/admin/ebook-activity/page";

function responseData() {
  return {
    rows: [
      {
        id: "session-1",
        user: {
          id: "u1",
          name: "Budi",
          role: "STUDENT",
          class: "XI IPA 1",
          identityNumber: "12345",
        },
        book: {
          id: "b1",
          title: "Matematika Terapan",
          author: "Tim Guru",
          pageCount: 100,
        },
        loan: {
          id: "loan-1",
          borrowedAt: "2026-10-20T01:00:00.000Z",
          expiresAt: "2026-10-27T01:00:00.000Z",
          returnedAt: null,
          accessState: "ACTIVE",
        },
        firstOpenedAt: "2026-10-22T03:40:00.000Z",
        lastActivityAt: "2026-10-22T03:55:00.000Z",
        endedAt: null,
        status: "ACTIVE",
        activityCount: 2,
        lastPage: null,
        progressPercent: null,
        progressAvailable: false,
      },
    ],
    total: 3,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    summary: {
      totalSessions: 3,
      uniqueUsers: 2,
      uniqueBooks: 1,
      activeSessions: 1,
      openedSessions: 1,
      inactiveSessions: 1,
    },
    period: { key: "30d", label: "30 hari terakhir" },
    pageTrackingSupported: false,
  };
}

function accessHistoryData() {
  return {
    source: "EbookLoan",
    readingEvidence: false,
    notice:
      "Data ini berasal dari riwayat peminjaman ebook. Data membuktikan peminjaman atau masa akses, bukan bukti bahwa ebook benar-benar dibuka atau dibaca.",
    rows: [
      {
        id: "loan-1",
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
          archivedAt: "2026-10-01T00:00:00.000Z",
          isArchived: true,
        },
        borrowedAt: "2026-10-10T01:00:00.000Z",
        expiresAt: "2026-10-15T01:00:00.000Z",
        returnedAt: "2026-10-12T01:00:00.000Z",
        status: "RETURNED",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    summary: {
      totalLoans: 14,
      uniqueUsers: 5,
      uniqueBooks: 3,
      activeLoans: 1,
      returnedLoans: 6,
      expiredLoans: 7,
    },
    period: {
      key: "30d",
      label: "30 hari terakhir",
      start: "2026-09-22T00:00:00.000Z",
      end: "2026-10-22T00:00:00.000Z",
    },
    filters: { search: "", status: "ALL", period: "30d" },
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

describe("dashboard ADMIN aktivitas membaca", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("/api/admin/ebook-access-history")
        ? jsonResponse(accessHistoryData())
        : jsonResponse(responseData());
    }) as unknown as typeof fetch;
  });

  it("menampilkan sesi, pengguna unik, ebook unik, dan status progres", async () => {
    render(<AdminEbookActivityPage />);

    expect(
      await screen.findByRole("heading", { name: /Aktivitas Membaca Ebook/i })
    ).toBeTruthy();
    expect(await screen.findByText("Total Sesi")).toBeTruthy();
    expect(screen.getByText("Pengguna Unik")).toBeTruthy();
    expect(screen.getByText("Ebook Unik")).toBeTruthy();
    expect(screen.getByText("Budi")).toBeTruthy();
    expect(screen.getByText("Matematika Terapan")).toBeTruthy();
    expect(
      screen.getByText("Belum tercatat")
    ).toBeTruthy();
    expect(screen.getByText(/Masa akses aktif/)).toBeTruthy();
    expect(screen.getByText(/bukan bukti pengguna membaca/)).toBeTruthy();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/ebook-activity?"),
        expect.objectContaining({ cache: "no-store" })
      );
    });
  });

  it("menampilkan tab riwayat peminjaman dengan sumber EbookLoan dan penanda arsip", async () => {
    render(<AdminEbookActivityPage />);

    expect(await screen.findByText("Budi")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("tab", { name: /Riwayat Peminjaman\/Akses Ebook/i })
    );

    expect(
      await screen.findByText(/Data ini berasal dari riwayat peminjaman ebook/i)
    ).toBeTruthy();
    expect(screen.getByText("Sumber: EbookLoan")).toBeTruthy();
    expect(screen.getByText("Bukan bukti membaca")).toBeTruthy();
    expect(screen.getByText("Siti")).toBeTruthy();
    expect(screen.getByText("Ebook Lama")).toBeTruthy();
    expect(screen.getByText("Ebook diarsipkan")).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Waktu Peminjaman" })
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Masa Akses Berakhir" })
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Waktu Pengembalian" })
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Status Peminjaman" })
    ).toBeTruthy();
    expect(screen.queryByText("Halaman / Progres")).toBeNull();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/ebook-access-history?"),
        expect.objectContaining({ cache: "no-store" })
      );
    });
  });

  it("tidak mencampur ringkasan aktivitas membaca dengan ringkasan peminjaman", async () => {
    const zeroReading = {
      ...responseData(),
      rows: [],
      total: 0,
      summary: {
        totalSessions: 0,
        uniqueUsers: 0,
        uniqueBooks: 0,
        activeSessions: 0,
        openedSessions: 0,
        inactiveSessions: 0,
      },
    };
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("/api/admin/ebook-access-history")
        ? jsonResponse(accessHistoryData())
        : jsonResponse(zeroReading);
    }) as unknown as typeof fetch;

    render(<AdminEbookActivityPage />);

    expect(await screen.findByText("Belum ada aktivitas membaca")).toBeTruthy();
    const totalSessionsCard = screen
      .getByText("Total Sesi")
      .closest(".stat-card") as HTMLElement;
    expect(within(totalSessionsCard).getByText("0")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("tab", { name: /Riwayat Peminjaman\/Akses Ebook/i })
    );
    expect(await screen.findByText("Total Peminjaman")).toBeTruthy();
    const totalLoansCard = screen
      .getByText("Total Peminjaman")
      .closest(".stat-card") as HTMLElement;
    expect(within(totalLoansCard).getByText("14")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("tab", { name: /Aktivitas Membaca/i })
    );
    await waitFor(() => {
      expect(screen.getByText("Belum ada aktivitas membaca")).toBeTruthy();
    });
    const totalSessionsCardAgain = screen
      .getByText("Total Sesi")
      .closest(".stat-card") as HTMLElement;
    expect(within(totalSessionsCardAgain).getByText("0")).toBeTruthy();
  });
});
