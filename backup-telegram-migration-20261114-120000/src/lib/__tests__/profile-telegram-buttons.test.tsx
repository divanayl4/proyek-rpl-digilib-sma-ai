/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import ProfileForm, { ProfileUser } from "@/components/profile/ProfileForm";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const baseUser: ProfileUser = {
  id: "student-1",
  name: "Siswa Satu",
  email: "siswa@sma.id",
  role: "STUDENT",
  gender: null,
  identityNumber: "2024001",
  class: "XI TKJ",
  telegramLinked: false,
};

describe("ProfileForm — tombol Telegram", () => {
  it("saat belum terhubung: menampilkan Hubungkan Telegram, bukan tombol putus", () => {
    render(<ProfileForm user={{ ...baseUser, telegramLinked: false }} />);

    expect(screen.getByText("Hubungkan Telegram")).toBeTruthy();
    expect(screen.queryByText("Putuskan Koneksi Telegram")).toBeNull();
    expect(screen.queryByText("Hubungkan Ulang")).toBeNull();
  });

  it("saat terhubung: hanya menampilkan Putuskan Koneksi Telegram", () => {
    render(<ProfileForm user={{ ...baseUser, telegramLinked: true }} />);

    expect(screen.getByText("Putuskan Koneksi Telegram")).toBeTruthy();
    expect(screen.queryByText("Hubungkan Telegram")).toBeNull();
    expect(screen.queryByText("Hubungkan Ulang")).toBeNull();
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "role peminjam %s melihat tombol Hubungkan Telegram",
    (role) => {
      render(<ProfileForm user={{ ...baseUser, role, telegramLinked: false }} />);

      expect(screen.getByText("Hubungkan Telegram")).toBeTruthy();
      expect(screen.queryByText("Putuskan Koneksi Telegram")).toBeNull();
    }
  );

  it.each(["ADMIN", "LIBRARIAN"])(
    "role non-peminjam %s tidak menampilkan kartu Telegram sama sekali",
    (role) => {
      render(<ProfileForm user={{ ...baseUser, role, telegramLinked: true }} />);

      expect(screen.queryByText("Putuskan Koneksi Telegram")).toBeNull();
      expect(screen.queryByText("Hubungkan Telegram")).toBeNull();
    }
  );

  it("setelah konfirmasi putus koneksi, tombol Hubungkan Telegram muncul kembali", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Koneksi Telegram berhasil diputuskan." }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      render(<ProfileForm user={{ ...baseUser, telegramLinked: true }} />);

      fireEvent.click(screen.getByText("Putuskan Koneksi Telegram"));
      fireEvent.click(await screen.findByText("Ya, Putuskan"));

      expect(await screen.findByText("Hubungkan Telegram")).toBeTruthy();
      expect(screen.queryByText("Putuskan Koneksi Telegram")).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith("/api/telegram/link", { method: "DELETE" });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
