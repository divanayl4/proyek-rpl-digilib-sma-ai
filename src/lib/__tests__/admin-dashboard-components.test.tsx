/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import SystemActivityChart from "@/components/admin/SystemActivityChart";
import RecentUsersTable from "@/components/admin/RecentUsersTable";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("Admin Dashboard Components", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("SystemActivityChart component", () => {
    it("menampilkan judul dan empty state jika belum ada data aktivitas", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({ data: [], period: "7days" })
      ) as unknown as typeof fetch;

      render(<SystemActivityChart />);

      expect(screen.getByText("Aktivitas Sistem")).toBeTruthy();
      expect(
        await screen.findByText("Belum ada data aktivitas pada periode ini")
      ).toBeTruthy();
    });
  });

  describe("RecentUsersTable component", () => {
    it("menampilkan daftar pengguna terbaru dengan badge peran yang sesuai", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          users: [
            {
              id: "u-1",
              name: "Siti Rahma",
              email: "siti@smk.sch.id",
              role: "STUDENT",
              createdAt: "2026-10-24T08:00:00Z",
            },
            {
              id: "u-2",
              name: "Pak Budi Guru",
              email: "budi@smk.sch.id",
              role: "TEACHER",
              createdAt: "2026-10-23T08:00:00Z",
            },
          ],
          total: 2,
        })
      ) as unknown as typeof fetch;

      render(<RecentUsersTable />);

      expect(screen.getByText("Pengguna Terbaru")).toBeTruthy();
      expect(await screen.findByText("Siti Rahma")).toBeTruthy();
      expect(screen.getByText("Pak Budi Guru")).toBeTruthy();
      expect(screen.getByText("Siswa")).toBeTruthy();
      expect(screen.getByText("Guru")).toBeTruthy();
    });

    it("menampilkan empty state jika belum ada pengguna", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({ users: [], total: 0 })
      ) as unknown as typeof fetch;

      render(<RecentUsersTable />);

      expect(screen.getByText("Pengguna Terbaru")).toBeTruthy();
      expect(
        await screen.findByText("Belum ada pengguna yang mendaftar")
      ).toBeTruthy();
    });
  });
});
