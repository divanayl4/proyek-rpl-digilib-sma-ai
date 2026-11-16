/**
 * Page-level access tests for the shared fines pages.
 *
 * Admin uses the same existing pages as Pustakawan – there are no duplicates.
 * Both roles must be able to open them; all other roles are redirected.
 */

import React from "react";

const mockGetServerSession = jest.fn();
const mockRedirect = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/components/layout/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

jest.mock("@/components/fines/FineManagementView", () => ({
  __esModule: true,
  default: () => React.createElement("div", { "data-testid": "fines-view" }),
}));

jest.mock("@/components/admin/SettingsView", () => ({
  __esModule: true,
  default: () => React.createElement("div", { "data-testid": "settings-view" }),
}));

import LibrarianFinesPage from "@/app/librarian/fines/page";
import LibrarianFineSettingsPage from "@/app/librarian/settings/page";
import { calculateFine, LIBRARY_CONFIG } from "@/lib/config/library";
import { EBOOK_CONFIG } from "@/lib/config/ebook";

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", role } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Manajemen Denda page", () => {
  it.each(["ADMIN", "LIBRARIAN"])("lets %s open the page", async (role) => {
    signInAs(role);

    const page = await LibrarianFinesPage();

    expect(page).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "redirects %s away from the page",
    async (role) => {
      signInAs(role);

      await LibrarianFinesPage();

      expect(mockRedirect).toHaveBeenCalledWith("/login");
    }
  );

  it("redirects an unauthenticated visitor", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await LibrarianFinesPage();

    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});

describe("Tarif Denda page", () => {
  it.each(["ADMIN", "LIBRARIAN"])("lets %s open the page", async (role) => {
    signInAs(role);

    const page = await LibrarianFineSettingsPage();

    expect(page).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "redirects %s away from the page",
    async (role) => {
      signInAs(role);

      await LibrarianFineSettingsPage();

      expect(mockRedirect).toHaveBeenCalledWith("/login");
    }
  );
});

describe("Aturan yang tidak berubah", () => {
  it("keeps the fine formula (late days × daily rate)", () => {
    const day = 24 * 3600 * 1000;
    const due = new Date("2026-01-10T00:00:00Z");
    const returned = new Date(due.getTime() + 3 * day);

    expect(calculateFine(due, returned, 1000)).toBe(3000);
  });

  it("keeps ADMIN and LIBRARIAN as the shared fine managers", () => {
    expect(LIBRARY_CONFIG.librarianRoles).toEqual(["ADMIN", "LIBRARIAN"]);
  });

  it("does not widen ebook borrowing to Staff", () => {
    expect(EBOOK_CONFIG.borrowerRoles).toEqual(["STUDENT", "TEACHER"]);
    expect(LIBRARY_CONFIG.borrowerRoles).toEqual(["STUDENT", "TEACHER", "STAFF"]);
  });
});
