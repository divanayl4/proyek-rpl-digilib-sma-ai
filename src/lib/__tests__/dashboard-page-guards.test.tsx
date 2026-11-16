/**
 * Page-level authorization tests for the role dashboards.
 *
 * Every dashboard must verify the session and the role on the server before
 * reading any data. `redirect()` in Next.js terminates the request by throwing
 * a NEXT_REDIRECT signal, so the mock throws the same way; that lets the tests
 * prove that no Prisma query runs after a rejected access.
 */

import React from "react";

const mockGetServerSession = jest.fn();
const mockRedirect = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT");
  },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/components/layout/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

jest.mock("@/lib/recommendations", () => ({
  getRecommendationsForUser: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: jest.fn() },
    book: { count: jest.fn(), findMany: jest.fn() },
    borrowRecord: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    ebookLoan: { count: jest.fn(), findMany: jest.fn() },
  },
}));

import AdminPage from "@/app/admin/page";
import LibrarianPage from "@/app/librarian/page";
import StaffPage from "@/app/staff/page";
import StudentPage from "@/app/student/page";
import TeacherPage from "@/app/teacher/page";
import { prisma } from "@/lib/prisma";

const ALL_ROLES = ["ADMIN", "LIBRARIAN", "STUDENT", "TEACHER", "STAFF"];

const PAGES = [
  {
    name: "Dasbor Administrator",
    Page: AdminPage,
    allowed: ["ADMIN"],
    denied: ALL_ROLES.filter((role) => role !== "ADMIN"),
  },
  {
    name: "Dasbor Pustakawan",
    Page: LibrarianPage,
    allowed: ["ADMIN", "LIBRARIAN"],
    denied: ALL_ROLES.filter((role) => !["ADMIN", "LIBRARIAN"].includes(role)),
  },
  {
    name: "Dasbor Staf",
    Page: StaffPage,
    allowed: ["ADMIN", "STAFF"],
    denied: ALL_ROLES.filter((role) => !["ADMIN", "STAFF"].includes(role)),
  },
  {
    name: "Dasbor Siswa",
    Page: StudentPage,
    allowed: ["ADMIN", "STUDENT"],
    denied: ALL_ROLES.filter((role) => !["ADMIN", "STUDENT"].includes(role)),
  },
  {
    name: "Dasbor Guru",
    Page: TeacherPage,
    allowed: ["ADMIN", "TEACHER"],
    denied: ALL_ROLES.filter((role) => !["ADMIN", "TEACHER"].includes(role)),
  },
];

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role } });
}

function dataQueries(): jest.Mock[] {
  return [
    prisma.user.count,
    prisma.book.count,
    prisma.book.findMany,
    prisma.borrowRecord.count,
    prisma.borrowRecord.findMany,
    prisma.borrowRecord.groupBy,
    prisma.ebookLoan.count,
    prisma.ebookLoan.findMany,
  ] as jest.Mock[];
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.count as jest.Mock).mockResolvedValue(0);
  (prisma.book.count as jest.Mock).mockResolvedValue(0);
  (prisma.book.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
  (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
  (prisma.ebookLoan.count as jest.Mock).mockResolvedValue(0);
  (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([]);
});

describe.each(PAGES)("$name — otorisasi server-side", ({ Page, allowed, denied }) => {
  it("mengarahkan pengunjung tanpa sesi ke /login tanpa membaca data", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith("/login");
    for (const query of dataQueries()) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each(denied)("menolak role %s dan mengarahkan ke /dashboard", async (role) => {
    signInAs(role);

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    for (const query of dataQueries()) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each(allowed)("mengizinkan role %s membuka halaman", async (role) => {
    signInAs(role);

    await expect(Page()).resolves.toBeTruthy();

    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
