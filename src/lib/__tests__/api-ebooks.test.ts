/**
 * Authorization tests for the ebook read path.
 *
 * These exercise the real route handlers against a mocked Prisma client so we
 * can prove the server – not the browser UI – is what enforces the 5-day lock
 * and per-user isolation.
 */

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: { findUnique: jest.fn() },
    ebookLoan: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/notifications", () => ({
  notifyEbookBorrowed: jest.fn(),
  notifyEbookExpired: jest.fn(),
  notifyEbookReturned: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { EBOOK_READ_COOKIE, signEbookReadToken } from "@/lib/config/ebook";
import { EBOOK_STORAGE_ROOT, resolveEbookFilePath } from "@/lib/ebook-access";
import { GET as getEbookFile } from "@/app/api/ebooks/[id]/file/route";
import { POST as postEbookAccess } from "@/app/api/ebooks/[id]/access/route";

const SECRET = "unit-test-secret";
const NOW = new Date();

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const BOOK_ID = "book-1";

const STORAGE_DIR = path.join(process.cwd(), "storage", "ebooks");
const TEST_FILE_NAME = "__jest-ebook-test.pdf";

const msFromNow = (ms: number) => new Date(Date.now() + ms);

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(STORAGE_DIR, TEST_FILE_NAME),
    Buffer.from("%PDF-1.4\n% minimal test document\n%%EOF\n", "latin1")
  );
});

afterAll(() => {
  fs.rmSync(path.join(STORAGE_DIR, TEST_FILE_NAME), { force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role: "STUDENT" } });
  (prisma.ebookLoan.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
});

function mockEbookBook(overrides: Record<string, unknown> = {}) {
  (prisma.book.findUnique as jest.Mock).mockResolvedValue({
    id: BOOK_ID,
    title: "Ebook Uji",
    author: "Penulis",
    format: "EBOOK",
    filePath: TEST_FILE_NAME,
    pageCount: 3,
    ...overrides,
  });
}

function mockLoan(overrides: Record<string, unknown> = {}) {
  const loan = {
    id: "loan-1",
    borrowedAt: msFromNow(-60_000),
    expiresAt: msFromNow(4 * 24 * 3600 * 1000),
    returnedAt: null,
    status: "ACTIVE",
    ...overrides,
  };
  (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue(loan);
  return loan;
}

function buildFileRequest(token?: string) {
  const query = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
  return new NextRequest(
    `http://localhost:3000/api/ebooks/${BOOK_ID}/file${query}`
  );
}

function buildAccessRequest(bookId: string = BOOK_ID) {
  return new NextRequest(`http://localhost:3000/api/ebooks/${bookId}/access`);
}

function buildFileRequestWithCookie(token?: string) {
  return new NextRequest(
    `http://localhost:3000/api/ebooks/${BOOK_ID}/file`,
    token ? { headers: { cookie: `${EBOOK_READ_COOKIE}=${token}` } } : {}
  );
}

describe("Ebook file endpoint – authorization", () => {
  it("rejects an unauthenticated request with 401", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockEbookBook();
    mockLoan();

    const res = await getEbookFile(buildFileRequest("anything"), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(401);
    expect(prisma.ebookLoan.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a user with no loan with 403", async () => {
    mockEbookBook();
    (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await getEbookFile(buildFileRequest("anything"), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(403);
  });

  it("serves the file when the user owns an active loan with a valid token", async () => {
    mockEbookBook();
    const loan = mockLoan();
    const token = signEbookReadToken(USER_ID, BOOK_ID, loan.expiresAt, SECRET);

    const res = await getEbookFile(buildFileRequest(token), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("serves the file when the token arrives in the read cookie", async () => {
    mockEbookBook();
    const loan = mockLoan();
    // The stable viewer URL carries no token; the credential rides in the
    // path-scoped cookie instead.
    const token = signEbookReadToken(USER_ID, BOOK_ID, loan.expiresAt, SECRET);

    const res = await getEbookFile(buildFileRequestWithCookie(token), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(200);
  });

  it("denies a cookie token minted for a different user", async () => {
    mockEbookBook();
    const loan = mockLoan();
    const stolenToken = signEbookReadToken(OTHER_USER_ID, BOOK_ID, loan.expiresAt, SECRET);

    const res = await getEbookFile(buildFileRequestWithCookie(stolenToken), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(403);
  });

  it("denies a request whose cookie token is garbage", async () => {
    mockEbookBook();
    mockLoan();

    const res = await getEbookFile(buildFileRequestWithCookie("1234.deadbeef"), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(403);
  });

  it("locks the file with 410 once expiresAt has passed", async () => {
    mockEbookBook();
    const loan = mockLoan({
      borrowedAt: msFromNow(-6 * 24 * 3600 * 1000),
      expiresAt: msFromNow(-24 * 3600 * 1000),
      // Deliberately stale: the server must not trust this column.
      status: "ACTIVE",
    });
    const token = signEbookReadToken(USER_ID, BOOK_ID, loan.expiresAt, SECRET);

    const res = await getEbookFile(buildFileRequest(token), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.reason).toBe("EXPIRED");
  });

  it("flips the stored status to EXPIRED when the window lapses", async () => {
    mockEbookBook();
    mockLoan({
      borrowedAt: msFromNow(-6 * 24 * 3600 * 1000),
      expiresAt: msFromNow(-1000),
      status: "ACTIVE",
    });

    await getEbookFile(buildFileRequest(), { params: { id: BOOK_ID } });

    expect(prisma.ebookLoan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
        data: { status: "EXPIRED" },
      })
    );
  });

  it("locks the file with 403 after the ebook was returned", async () => {
    mockEbookBook();
    mockLoan({ returnedAt: msFromNow(-1000), status: "RETURNED" });

    const res = await getEbookFile(buildFileRequest("anything"), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(403);
  });

  it("never queries another user's loans", async () => {
    mockEbookBook();
    mockLoan();

    await getEbookFile(buildFileRequest(), { params: { id: BOOK_ID } });

    expect(prisma.ebookLoan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID, bookId: BOOK_ID }),
      })
    );
  });

  it("denies a user who replays a token minted for a different user", async () => {
    mockEbookBook();
    const loan = mockLoan();
    // Attacker holds a structurally valid token issued for another account.
    const stolenToken = signEbookReadToken(OTHER_USER_ID, BOOK_ID, loan.expiresAt, SECRET);

    const res = await getEbookFile(buildFileRequest(stolenToken), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(403);
  });

  it("denies a request with no read token", async () => {
    mockEbookBook();
    mockLoan();

    const res = await getEbookFile(buildFileRequest(undefined), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(403);
  });

  it("denies a request with a garbage read token", async () => {
    mockEbookBook();
    mockLoan();

    const res = await getEbookFile(buildFileRequest("1234.deadbeef"), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown ebook", async () => {
    (prisma.book.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await getEbookFile(buildFileRequest(), { params: { id: "nope" } });

    expect(res.status).toBe(404);
  });

  it("refuses to serve a physical book through the ebook route", async () => {
    mockEbookBook({ format: "PHYSICAL" });

    const res = await getEbookFile(buildFileRequest(), { params: { id: BOOK_ID } });

    expect(res.status).toBe(404);
  });

  it("refuses to serve an ebook that has no file attached", async () => {
    mockEbookBook({ filePath: null });

    const res = await getEbookFile(buildFileRequest(), { params: { id: BOOK_ID } });

    expect(res.status).toBe(404);
  });

  it("blocks path traversal attempts stored in filePath", async () => {
    mockEbookBook({ filePath: "../../.env" });
    const loan = mockLoan();
    const token = signEbookReadToken(USER_ID, BOOK_ID, loan.expiresAt, SECRET);

    const res = await getEbookFile(buildFileRequest(token), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(404);
  });

  it("blocks absolute paths stored in filePath", async () => {
    mockEbookBook({ filePath: "C:\\Windows\\win.ini" });
    const loan = mockLoan();
    const token = signEbookReadToken(USER_ID, BOOK_ID, loan.expiresAt, SECRET);

    const res = await getEbookFile(buildFileRequest(token), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(404);
  });
});

describe("resolveEbookFilePath", () => {
  it("resolves a plain relative name inside the storage root", () => {
    const resolved = resolveEbookFilePath("sample.pdf");
    expect(resolved.startsWith(EBOOK_STORAGE_ROOT)).toBe(true);
    expect(resolved.endsWith("sample.pdf")).toBe(true);
  });

  it("allows a nested relative path that stays inside the root", () => {
    const resolved = resolveEbookFilePath(path.join("sains", "sample.pdf"));
    expect(resolved.startsWith(EBOOK_STORAGE_ROOT + path.sep)).toBe(true);
  });

  it("rejects parent-directory traversal", () => {
    expect(() => resolveEbookFilePath("../../.env")).toThrow("INVALID_FILE_PATH");
    expect(() => resolveEbookFilePath("nested/../../../secrets.txt")).toThrow(
      "INVALID_FILE_PATH"
    );
    // Backslash is a path separator only on Windows. On POSIX it is a literal
    // filename character, so a value such as "..\\..\\.env" stays inside the
    // storage root and cannot traverse to a parent directory.
    if (process.platform === "win32") {
      expect(() => resolveEbookFilePath("..\\..\\.env")).toThrow("INVALID_FILE_PATH");
    }
  });

  it("rejects absolute paths", () => {
    expect(() => resolveEbookFilePath("/etc/passwd")).toThrow("INVALID_FILE_PATH");
    // A Windows drive path is absolute only when resolved on Windows.
    if (process.platform === "win32") {
      expect(() => resolveEbookFilePath("C:\\Windows\\win.ini")).toThrow("INVALID_FILE_PATH");
    }
  });

  it("rejects empty and null-ish paths", () => {
    expect(() => resolveEbookFilePath(null)).toThrow("INVALID_FILE_PATH");
    expect(() => resolveEbookFilePath(undefined)).toThrow("INVALID_FILE_PATH");
    expect(() => resolveEbookFilePath("")).toThrow("INVALID_FILE_PATH");
  });

  it("rejects a NUL byte injection attempt", () => {
    expect(() => resolveEbookFilePath("sample.pdf\0.txt")).toThrow("INVALID_FILE_PATH");
  });
});

describe("Ebook access endpoint", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await postEbookAccess(
      buildAccessRequest(),
      { params: { id: BOOK_ID } }
    );

    expect(res.status).toBe(401);
  });

  it("issues a short-lived token for an active loan", async () => {
    mockEbookBook();
    const loan = mockLoan();

    const res = await postEbookAccess(
      buildAccessRequest(),
      { params: { id: BOOK_ID } }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessState).toBe("ACTIVE");
    expect(body.loan.expiresAt).toBe(loan.expiresAt.toISOString());
    expect(body.fileUrl).toContain(encodeURIComponent(body.token));
    expect(body.tokenExpiresAt).toBeDefined();
  });

  it("sets a path-scoped HttpOnly cookie carrying the read token", async () => {
    mockEbookBook();
    const loan = mockLoan();

    const res = await postEbookAccess(
      buildAccessRequest(),
      { params: { id: BOOK_ID } }
    );

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${EBOOK_READ_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain(
      `Path=/api/ebooks/${encodeURIComponent(BOOK_ID)}/file`
    );
    expect(loan.expiresAt).toBeInstanceOf(Date);
  });

  it("withholds the token once the window has lapsed", async () => {
    mockEbookBook();
    mockLoan({ borrowedAt: msFromNow(-6 * 24 * 3600 * 1000), expiresAt: msFromNow(-1000) });

    const res = await postEbookAccess(
      buildAccessRequest(),
      { params: { id: BOOK_ID } }
    );

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.token).toBeUndefined();
  });

  it("withholds the token for a user who never borrowed the ebook", async () => {
    mockEbookBook();
    (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await postEbookAccess(
      buildAccessRequest(),
      { params: { id: BOOK_ID } }
    );

    expect(res.status).toBe(403);
    expect((await res.json()).token).toBeUndefined();
  });
});