/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/layout/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import BorrowManagementView from "@/components/borrows/BorrowManagementView";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

const physicalRow = {
  id: "book-1",
  itemType: "book",
  borrowDate: "2026-10-20T01:15:00.000Z",
  dueDate: "2026-10-27T01:15:00.000Z",
  returnDate: null,
  status: "BORROWED",
  effectiveStatus: "BORROWED",
  notes: null,
  borrowReason: "Tugas sekolah",
  fineAmount: 0,
  finePaid: false,
  user: {
    id: "u-book",
    name: "Budi",
    email: "budi@example.test",
    role: "STUDENT",
    class: "XI IPA 1",
    identityNumber: "1001",
  },
  book: {
    id: "bk-1",
    title: "Buku Fisik Pinjaman",
    author: "Penulis Buku",
    isbn: "978-1",
    coverUrl: null,
  },
  createdBy: null,
};

const ebookRow = {
  id: "ebook:loan-1",
  itemType: "ebook",
  borrowDate: "2026-10-22T03:51:44.919Z",
  dueDate: "2026-10-27T03:51:44.919Z",
  returnDate: "2026-10-23T04:15:00.000Z",
  status: "RETURNED",
  effectiveStatus: "RETURNED",
  notes: null,
  borrowReason: null,
  fineAmount: 0,
  finePaid: true,
  user: {
    id: "u-ebook",
    name: "Siti",
    email: "siti@example.test",
    role: "STUDENT",
    class: "XII IPA 1",
    identityNumber: "2024001",
  },
  book: {
    id: "eb-1",
    title: "Ebook Lama",
    author: "Penulis Ebook",
    isbn: null,
    coverUrl: null,
    archivedAt: "2026-10-01T00:00:00.000Z",
    isArchived: true,
  },
  createdBy: null,
};

function transactionsData() {
  return {
    borrows: [ebookRow, physicalRow],
    total: 2,
    page: 1,
    totalPages: 1,
    summary: {
      total: 2,
      requested: 0,
      borrowed: 1,
      overdue: 0,
      returned: 1,
      cancelled: 0,
      rejected: 0,
      physicalTotal: 1,
      physicalActive: 0,
      ebookTotal: 1,
      ebookActive: 0,
      ebookReturned: 1,
      ebookExpired: 0,
    },
  };
}

describe("BorrowManagementView - riwayat ebook di halaman transaksi", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () =>
      jsonResponse(transactionsData())
    ) as unknown as typeof fetch;
  });

  it("menampilkan ebook, peminjam, waktu mulai/berakhir/pengembalian, dan arsip", async () => {
    render(
      <BorrowManagementView title="Transaksi Peminjaman" subtitle="Test" />
    );

    expect(await screen.findByText("Ebook Lama")).toBeTruthy();
    expect(screen.getByText("Siti")).toBeTruthy();
    expect(screen.getByText(/XII IPA 1/)).toBeTruthy();
    expect(screen.getByText("Ebook diarsipkan")).toBeTruthy();
    expect(screen.getAllByText("Dikembalikan").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10[.:]51/).length).toBeGreaterThan(0);
    expect(screen.getByText(/11[.:]15/)).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Dikembalikan" })
    ).toBeTruthy();
    expect(screen.getByText("Buku Fisik Pinjaman")).toBeTruthy();
    expect(screen.getByText("Transaksi Buku Fisik")).toBeTruthy();
    expect(screen.getByText("Transaksi Ebook")).toBeTruthy();
    expect(screen.getByText("Buku Fisik Aktif")).toBeTruthy();
    expect(screen.getByText("Ebook Aktif")).toBeTruthy();
    expect(screen.queryByText(/Progres|Halaman terakhir|Durasi membaca/i)).toBeNull();
  });

  it("mengirim kategori ebook ke API saat filter kategori dipilih", async () => {
    render(
      <BorrowManagementView title="Transaksi Peminjaman" subtitle="Test" />
    );

    await screen.findByText("Ebook Lama");
    fireEvent.click(screen.getByRole("button", { name: "Ebook" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("type=ebook")
      );
    });
  });

  it("menampilkan error, bukan daftar kosong, saat API gagal", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    render(
      <BorrowManagementView title="Transaksi Peminjaman" subtitle="Test" />
    );

    expect(await screen.findByText("Gagal memuat transaksi")).toBeTruthy();
    expect(screen.queryByText("Tidak ada transaksi")).toBeNull();
  });
});
