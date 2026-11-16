/**
 * @jest-environment jsdom
 */

/**
 * Reader tests for the manager "Lihat Buku" path.
 *
 * The reader must trust the server's operator flag, show the document, and not
 * display the "Ebook Terkunci" screen to Admin/Pustakawan without a loan.
 */

import { render, screen, waitFor } from "@testing-library/react";
import EbookReaderView from "@/components/ebooks/EbookReaderView";

const mockPush = jest.fn();
const mockSession = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => mockSession(),
}));

function operatorPayload() {
  return {
    token: "operator-token",
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    fileUrl: "/api/ebooks/book-1/file?token=operator-token",
    accessState: "ACTIVE",
    operator: true,
    loan: null,
    book: { id: "book-1", title: "Ebook Uji", author: "Penulis", pageCount: 10 },
    remainingMs: 0,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockReturnValue({ data: { user: { id: "manager-1", role: "ADMIN" } } });
});

describe("EbookReaderView – manager Lihat Buku", () => {
  it.each(["ADMIN", "LIBRARIAN"])(
    "opens the ebook document for %s without a loan",
    async (role) => {
      mockSession.mockReturnValue({ data: { user: { id: "manager-1", role } } });
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => operatorPayload(),
      })) as unknown as typeof fetch;

      render(<EbookReaderView bookId="book-1" />);

      const frame = await screen.findByTitle("Ebook Uji");
      expect(frame.getAttribute("src")).toBe(
        "/api/ebooks/book-1/file?token=operator-token"
      );
      expect(screen.getByText("Mode Baca Pengelola")).toBeTruthy();
      expect(screen.queryByText("Ebook Terkunci")).toBeNull();
    }
  );

  it("mencatat open/heartbeat/close tanpa halaman atau progres dari iframe PDF", async () => {
    mockSession.mockReturnValue({ data: { user: { id: "manager-1", role: "ADMIN" } } });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    const fetchMock: jest.Mock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => operatorPayload(),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<EbookReaderView bookId="book-1" />);
    await screen.findByTitle("Ebook Uji");

    await waitFor(() => {
      const activityCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/activity")
      );
      expect(activityCalls).toHaveLength(1);
      expect(JSON.parse(String(activityCalls[0][1]?.body))).toEqual({
        event: "open",
      });
    });

    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => {
      const heartbeat = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/activity") &&
          String(init?.body).includes("heartbeat")
      );
      expect(heartbeat).toBeTruthy();
    });

    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => {
      const close = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/activity") &&
          String(init?.body).includes("close")
      );
      expect(close).toBeTruthy();
    });

    for (const [url, init] of fetchMock.mock.calls) {
      if (!String(url).includes("/activity")) continue;
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ event: expect.any(String) });
      expect(body).not.toHaveProperty("page");
      expect(body).not.toHaveProperty("progress");
      expect(body).not.toHaveProperty("progressPercent");
      expect(body).not.toHaveProperty("userId");
    }
  });

  it("shows the locked screen when the server denies a borrower", async () => {
    mockSession.mockReturnValue({ data: { user: { id: "student-1", role: "STUDENT" } } });
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Anda belum meminjam ebook ini", reason: "NOT_BORROWED" }),
    })) as unknown as typeof fetch;

    render(<EbookReaderView bookId="book-1" />);

    await waitFor(() => {
      expect(screen.getByText("Ebook Terkunci")).toBeTruthy();
    });
    expect(screen.queryByTitle("Ebook Uji")).toBeNull();
  });
});
