/**
 * Tests for the ebook manager ("Lihat Buku") read path.
 *
 * Admin dan Pustakawan boleh membaca isi ebook tanpa meminjam. These tests
 * prove that:
 *   - the operator path is gated on the *verified session role*;
 *   - it never consults or creates an EbookLoan (no transaction, no change to
 *     any user's access window);
 *   - the sentinel-bound operator token is not a bypass for students/teachers.
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
import {
  EBOOK_OPERATOR_TOKEN_EXPIRES_AT,
  signEbookReadToken,
} from "@/lib/config/ebook";
import { GET as getEbookFile } from "@/app/api/ebooks/[id]/file/route";
import { POST as postEbookAccess } from "@/app/api/ebooks/[id]/access/route";

const SECRET = "unit-test-secret";
const BOOK_ID = "book-1";
const MANAGER_ID = "manager-1";

const STORAGE_DIR = path.join(process.cwd(), "storage", "ebooks");
const TEST_FILE_NAME = "__jest-ebook-operator-test.pdf";

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
  (prisma.book.findUnique as jest.Mock).mockResolvedValue({
    id: BOOK_ID,
    title: "Ebook Uji",
    author: "Penulis",
    format: "EBOOK",
    filePath: TEST_FILE_NAME,
    pageCount: 3,
  });
  (prisma.ebookLoan.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
});

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: MANAGER_ID, role } });
}

function accessRequest(bookId: string = BOOK_ID) {
  return new NextRequest(`http://localhost:3000/api/ebooks/${bookId}/access`);
}

function fileRequest(token?: string) {
  const query = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
  return new NextRequest(
    `http://localhost:3000/api/ebooks/${BOOK_ID}/file${query}`
  );
}

describe("Operator access decision (Lihat Buku)", () => {
  it.each(["ADMIN", "LIBRARIAN"])(
    "grants %s access to an ebook with no loan",
    async (role) => {
      signInAs(role);
      (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await postEbookAccess(accessRequest(), {
        params: { id: BOOK_ID },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accessState).toBe("ACTIVE");
      expect(body.operator).toBe(true);
      expect(body.loan).toBeNull();
      expect(body.fileUrl).toContain(encodeURIComponent(body.token));
    }
  );

  it.each(["ADMIN", "LIBRARIAN"])(
    "never consults a loan for a %s operator read",
    async (role) => {
      signInAs(role);

      await postEbookAccess(accessRequest(), { params: { id: BOOK_ID } });

      expect(prisma.ebookLoan.findFirst).not.toHaveBeenCalled();
      expect(prisma.ebookLoan.updateMany).not.toHaveBeenCalled();
    }
  );

  it("binds the operator token to the sentinel, not a loan expiry", async () => {
    signInAs("ADMIN");

    const res = await postEbookAccess(accessRequest(), {
      params: { id: BOOK_ID },
    });
    const { token } = await res.json();

    // A token signed with the sentinel verifies; one signed with a real date
    // does not. (Proves the sentinel is what the route expects.)
    const fileRes = await getEbookFile(fileRequest(token), {
      params: { id: BOOK_ID },
    });
    expect(fileRes.status).toBe(200);

    const wrongToken = signEbookReadToken(
      MANAGER_ID,
      BOOK_ID,
      msFromNow(4 * 24 * 3600 * 1000),
      SECRET
    );
    const wrongRes = await getEbookFile(fileRequest(wrongToken), {
      params: { id: BOOK_ID },
    });
    expect(wrongRes.status).toBe(403);
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "still denies a %s with no loan",
    async (role) => {
      signInAs(role);
      (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await postEbookAccess(accessRequest(), {
        params: { id: BOOK_ID },
      });

      expect(res.status).toBe(403);
      expect((await res.json()).token).toBeUndefined();
    }
  );
});

describe("Operator file endpoint", () => {
  it.each(["ADMIN", "LIBRARIAN"])(
    "serves the PDF to a %s without any loan",
    async (role) => {
      signInAs(role);
      const token = signEbookReadToken(
        MANAGER_ID,
        BOOK_ID,
        EBOOK_OPERATOR_TOKEN_EXPIRES_AT,
        SECRET
      );

      const res = await getEbookFile(fileRequest(token), {
        params: { id: BOOK_ID },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(prisma.ebookLoan.findFirst).not.toHaveBeenCalled();
    }
  );

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "denies a %s who presents an operator-style (sentinel) token",
    async (role) => {
      signInAs(role);
      (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue(null);
      // The sentinel token is structurally valid; the role is what denies it.
      const token = signEbookReadToken(
        MANAGER_ID,
        BOOK_ID,
        EBOOK_OPERATOR_TOKEN_EXPIRES_AT,
        SECRET
      );

      const res = await getEbookFile(fileRequest(token), {
        params: { id: BOOK_ID },
      });

      expect(res.status).toBe(403);
    }
  );

  it("still serves an operator whose book happens to have no file (404)", async () => {
    signInAs("ADMIN");
    (prisma.book.findUnique as jest.Mock).mockResolvedValue({
      id: BOOK_ID,
      title: "Ebook Kosong",
      author: "Penulis",
      format: "EBOOK",
      filePath: null,
      pageCount: null,
    });
    const token = signEbookReadToken(
      MANAGER_ID,
      BOOK_ID,
      EBOOK_OPERATOR_TOKEN_EXPIRES_AT,
      SECRET
    );

    const res = await getEbookFile(fileRequest(token), {
      params: { id: BOOK_ID },
    });

    expect(res.status).toBe(404);
  });
});
