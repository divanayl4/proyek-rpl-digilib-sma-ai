/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CategoryFormModal } from "@/components/books/CategoryFormModal";

const mockCategories = [
  { id: "cat-1", name: "Fiksi Ilmiah", _count: { books: 4 } },
  { id: "cat-2", name: "Teknologi", _count: { books: 0 } },
];

describe("CategoryFormModal Component", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("should not render modal contents when isOpen is false", () => {
    render(<CategoryFormModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByText("Kelola Kategori Buku")).toBeNull();
  });

  it("should fetch and render category list when isOpen is true", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockCategories,
    });

    render(<CategoryFormModal isOpen={true} onClose={jest.fn()} />);

    expect(screen.getByText("Kelola Kategori Buku")).toBeDefined();
    expect(screen.getByText("Memuat...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Fiksi Ilmiah")).toBeDefined();
      expect(screen.getByText("4 Buku")).toBeDefined();
      expect(screen.getByText("Teknologi")).toBeDefined();
      expect(screen.getByText("0 Buku")).toBeDefined();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/categories");
  });

  it("should display empty state when no categories exist", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(<CategoryFormModal isOpen={true} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Belum ada kategori")).toBeDefined();
    });
  });

  it("should handle adding a new category successfully", async () => {
    // 1st fetch: initial list
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockCategories,
    });
    // 2nd fetch: POST create
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "cat-3", name: "Sains Alam" }),
    });
    // 3rd fetch: re-fetch list after create
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [...mockCategories, { id: "cat-3", name: "Sains Alam", _count: { books: 0 } }],
    });

    render(<CategoryFormModal isOpen={true} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Fiksi Ilmiah")).toBeDefined();
    });

    const input = screen.getByPlaceholderText("Nama kategori...");
    fireEvent.change(input, { target: { value: "Sains Alam" } });

    const submitBtn = screen.getByRole("button", { name: /Tambah/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sains Alam" }),
      });
      expect(screen.getByText("Sains Alam")).toBeDefined();
    });
  });

  it("should display API error message when category creation fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockCategories,
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Kategori sudah ada" }),
    });

    render(<CategoryFormModal isOpen={true} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Fiksi Ilmiah")).toBeDefined();
    });

    const input = screen.getByPlaceholderText("Nama kategori...");
    fireEvent.change(input, { target: { value: "Fiksi Ilmiah" } });

    const submitBtn = screen.getByRole("button", { name: /Tambah/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Kategori sudah ada");
    });
  });

  it("should allow editing a category and cancelling edit", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockCategories,
    });

    render(<CategoryFormModal isOpen={true} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Teknologi")).toBeDefined();
    });

    // Click edit on "Teknologi"
    const editBtn = screen.getByLabelText("Edit kategori Teknologi");
    fireEvent.click(editBtn);

    expect(screen.getByText("Edit Kategori")).toBeDefined();
    const input = screen.getByPlaceholderText("Nama kategori...") as HTMLInputElement;
    expect(input.value).toBe("Teknologi");

    // Click "Batal"
    const cancelBtn = screen.getByRole("button", { name: /Batal/i });
    fireEvent.click(cancelBtn);

    expect(screen.getByText("Tambah Kategori Baru")).toBeDefined();
    expect(input.value).toBe("");
  });

  it("should open confirmation dialog and delete category with 0 books", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockCategories,
    });
    // DELETE response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: "Kategori dihapus" }),
    });
    // Refetch after delete
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [mockCategories[0]],
    });

    render(<CategoryFormModal isOpen={true} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Teknologi")).toBeDefined();
    });

    // cat-1 has 4 books -> delete button disabled
    const disabledDeleteBtn = screen.getByLabelText("Hapus kategori Fiksi Ilmiah") as HTMLButtonElement;
    expect(disabledDeleteBtn.disabled).toBe(true);

    // cat-2 has 0 books -> delete button enabled
    const enabledDeleteBtn = screen.getByLabelText("Hapus kategori Teknologi") as HTMLButtonElement;
    expect(enabledDeleteBtn.disabled).toBe(false);

    fireEvent.click(enabledDeleteBtn);

    // ConfirmationDialog should appear
    expect(screen.getByText("Hapus Kategori?")).toBeDefined();

    const confirmBtn = screen.getByRole("button", { name: "Ya, Hapus" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/categories/cat-2", { method: "DELETE" });
    });
  });
});
