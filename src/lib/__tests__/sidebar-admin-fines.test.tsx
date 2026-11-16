/**
 * @jest-environment jsdom
 */

/**
 * Navigation tests: Admin must reach the shared fines and tariff pages, while
 * Pustakawan keeps its existing links.
 */

import { render, screen } from "@testing-library/react";
import Sidebar from "@/components/layout/Sidebar";

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin",
}));

jest.mock("next-auth/react", () => ({
  signOut: jest.fn(),
}));

describe("Sidebar – Admin fines navigation", () => {
  it("links ADMIN to the shared fines management page", () => {
    render(<Sidebar role="ADMIN" isMobileOpen={false} onClose={jest.fn()} />);

    const link = screen.getByRole("link", { name: "Denda" });
    expect(link.getAttribute("href")).toBe("/librarian/fines");
  });

  it("links ADMIN to the fine-rate page", () => {
    render(<Sidebar role="ADMIN" isMobileOpen={false} onClose={jest.fn()} />);

    const link = screen.getByRole("link", { name: "Tarif Denda" });
    expect(link.getAttribute("href")).toBe("/admin/settings");
  });

  it("keeps both Pustakawan links unchanged", () => {
    render(<Sidebar role="LIBRARIAN" isMobileOpen={false} onClose={jest.fn()} />);

    expect(
      screen.getByRole("link", { name: "Denda" }).getAttribute("href")
    ).toBe("/librarian/fines");
    expect(
      screen.getByRole("link", { name: "Tarif Denda" }).getAttribute("href")
    ).toBe("/librarian/settings");
  });

  it("does not expose fines links to students", () => {
    render(<Sidebar role="STUDENT" isMobileOpen={false} onClose={jest.fn()} />);

    expect(screen.queryByRole("link", { name: "Denda" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Tarif Denda" })).toBeNull();
  });

  it("links only ADMIN to the AI configuration page", () => {
    const { unmount } = render(
      <Sidebar role="ADMIN" isMobileOpen={false} onClose={jest.fn()} />
    );
    expect(
      screen.getByRole("link", { name: "Konfigurasi AI" }).getAttribute("href")
    ).toBe("/admin/ai-config");
    unmount();

    for (const role of ["LIBRARIAN", "STUDENT", "TEACHER", "STAFF"]) {
      const rendered = render(
        <Sidebar role={role} isMobileOpen={false} onClose={jest.fn()} />
      );
      expect(
        screen.queryByRole("link", { name: "Konfigurasi AI" })
      ).toBeNull();
      rendered.unmount();
    }
  });
});
