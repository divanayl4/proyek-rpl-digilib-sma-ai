import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET as getCategories, POST as createCategory } from "@/app/api/categories/route";
import { PATCH as updateCategory, DELETE as deleteCategory } from "@/app/api/categories/[id]/route";

const ADMIN_SESSION = { user: { id: "admin-1", role: "ADMIN", name: "Pak Admin" } };
const LIBRARIAN_SESSION = { user: { id: "lib-1", role: "LIBRARIAN", name: "Ibu Pustakawan" } };
const STUDENT_SESSION = { user: { id: "stu-1", role: "STUDENT", name: "Siswa" } };

function createJsonRequest(url: string, method: string, body?: unknown): NextRequest {
  const init: Record<string, unknown> = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init as any);
}

describe("/api/categories & /api/categories/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/categories", () => {
    it("should allow any user to fetch categories ordered by name with book count", async () => {
      const mockCategories = [
        { id: "cat-1", name: "Fiksi", _count: { books: 12 } },
        { id: "cat-2", name: "Sains", _count: { books: 5 } },
      ];
      (prisma.category.findMany as jest.Mock).mockResolvedValue(mockCategories);

      const res = await getCategories();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual(mockCategories);
      expect(prisma.category.findMany).toHaveBeenCalledWith({
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: { books: true },
          },
        },
      });
    });

    it("should return 500 when category query fails", async () => {
      (prisma.category.findMany as jest.Mock).mockRejectedValue(new Error("Database error"));

      const res = await getCategories();
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe("Failed to fetch categories");
    });
  });

  describe("POST /api/categories", () => {
    it("should return 401 if user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const req = createJsonRequest("http://localhost:3000/api/categories", "POST", { name: "Biologi" });
      const res = await createCategory(req);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 403 if user role is STUDENT or TEACHER", async () => {
      mockGetServerSession.mockResolvedValue(STUDENT_SESSION);

      const req = createJsonRequest("http://localhost:3000/api/categories", "POST", { name: "Biologi" });
      const res = await createCategory(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("Forbidden");
    });

    it("should return 400 if category name is empty or invalid", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

      const invalidPayloads = [{ name: "" }, { name: "   " }, { name: null }, {}];

      for (const payload of invalidPayloads) {
        const req = createJsonRequest("http://localhost:3000/api/categories", "POST", payload);
        const res = await createCategory(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe("Nama kategori wajib diisi");
      }
    });

    it("should return 409 if category name already exists", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (prisma.category.findUnique as jest.Mock).mockResolvedValue({ id: "cat-old", name: "Teknologi" });

      const req = createJsonRequest("http://localhost:3000/api/categories", "POST", { name: "Teknologi" });
      const res = await createCategory(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe("Kategori sudah ada");
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it("should successfully create category and audit log when called by ADMIN or LIBRARIAN", async () => {
      mockGetServerSession.mockResolvedValue(LIBRARIAN_SESSION);
      (prisma.category.findUnique as jest.Mock).mockResolvedValue(null);

      const newCategory = { id: "cat-new", name: "Teknologi Informasi" };
      (prisma.category.create as jest.Mock).mockResolvedValue(newCategory);

      const req = createJsonRequest("http://localhost:3000/api/categories", "POST", {
        name: "  Teknologi Informasi  ",
      });
      const res = await createCategory(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data).toEqual(newCategory);
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: "Teknologi Informasi" },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: "CREATE_CATEGORY",
          userId: "lib-1",
          details: "Membuat kategori: Teknologi Informasi",
        },
      });
    });
  });

  describe("PATCH /api/categories/[id]", () => {
    it("should return 401 if unauthenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-1", "PATCH", { name: "Update" });
      const res = await updateCategory(req, { params: { id: "cat-1" } });

      expect(res.status).toBe(401);
    });

    it("should return 403 for non-admin/librarian", async () => {
      mockGetServerSession.mockResolvedValue(STUDENT_SESSION);

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-1", "PATCH", { name: "Update" });
      const res = await updateCategory(req, { params: { id: "cat-1" } });

      expect(res.status).toBe(403);
    });

    it("should return 400 if name is empty", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-1", "PATCH", { name: "  " });
      const res = await updateCategory(req, { params: { id: "cat-1" } });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Nama kategori wajib diisi");
    });

    it("should return 404 if target category not found", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-404", "PATCH", { name: "Sastra" });
      const res = await updateCategory(req, { params: { id: "cat-404" } });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("Kategori tidak ditemukan");
    });

    it("should return 409 if new name conflicts with another existing category", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      // First findUnique for target category
      (prisma.category.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: "cat-1", name: "Sastra Lama" })
        // Second findUnique for duplicate name check
        .mockResolvedValueOnce({ id: "cat-2", name: "Sastra Baru" });

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-1", "PATCH", { name: "Sastra Baru" });
      const res = await updateCategory(req, { params: { id: "cat-1" } });
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe("Kategori dengan nama tersebut sudah ada");
    });

    it("should successfully update category when valid", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (prisma.category.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: "cat-1", name: "Sastra Lama" })
        .mockResolvedValueOnce(null); // No conflict

      const updated = { id: "cat-1", name: "Sastra Indonesia" };
      (prisma.category.update as jest.Mock).mockResolvedValue(updated);

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-1", "PATCH", {
        name: "Sastra Indonesia",
      });
      const res = await updateCategory(req, { params: { id: "cat-1" } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual(updated);
      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { id: "cat-1" },
        data: { name: "Sastra Indonesia" },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: "UPDATE_CATEGORY",
          userId: "admin-1",
          details: "Mengubah kategori: Sastra Lama menjadi Sastra Indonesia",
        },
      });
    });
  });

  describe("DELETE /api/categories/[id]", () => {
    it("should return 401 if unauthenticated and 403 if unauthorized", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req1 = createJsonRequest("http://localhost:3000/api/categories/cat-1", "DELETE");
      expect((await deleteCategory(req1, { params: { id: "cat-1" } })).status).toBe(401);

      mockGetServerSession.mockResolvedValueOnce(STUDENT_SESSION);
      const req2 = createJsonRequest("http://localhost:3000/api/categories/cat-1", "DELETE");
      expect((await deleteCategory(req2, { params: { id: "cat-1" } })).status).toBe(403);
    });

    it("should return 404 if category to delete not found", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (prisma.category.findUnique as jest.Mock).mockResolvedValue(null);

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-999", "DELETE");
      const res = await deleteCategory(req, { params: { id: "cat-999" } });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("Kategori tidak ditemukan");
    });

    it("should return 400 if category still has associated books", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (prisma.category.findUnique as jest.Mock).mockResolvedValue({
        id: "cat-1",
        name: "Sains",
        _count: { books: 3 },
      });

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-1", "DELETE");
      const res = await deleteCategory(req, { params: { id: "cat-1" } });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Kategori tidak dapat dihapus karena masih memiliki buku");
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it("should delete category and create audit log if books count is 0", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (prisma.category.findUnique as jest.Mock).mockResolvedValue({
        id: "cat-1",
        name: "Kategori Kosong",
        _count: { books: 0 },
      });
      (prisma.category.delete as jest.Mock).mockResolvedValue({ id: "cat-1" });

      const req = createJsonRequest("http://localhost:3000/api/categories/cat-1", "DELETE");
      const res = await deleteCategory(req, { params: { id: "cat-1" } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.message).toBe("Kategori dihapus");
      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: "cat-1" } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: "DELETE_CATEGORY",
          userId: "admin-1",
          details: "Menghapus kategori: Kategori Kosong",
        },
      });
    });
  });
});
