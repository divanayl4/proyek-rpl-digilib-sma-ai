/**
 * Tests for the student recommendation helper.
 *
 * Rekomendasi harus berasal dari katalog nyata, mengecualikan buku yang sedang
 * dipinjam, dan mengutamakan buku yang relevan dengan riwayat/kelas siswa.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    borrowRecord: { findMany: jest.fn() },
    book: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  getRecommendationsForUser,
  gradeFromClass,
} from "@/lib/recommendations";

const book = (
  id: string,
  overrides: Partial<{ subject: string | null; grade: string | null; categoryId: string | null }> = {}
) => ({
  id,
  title: `Buku ${id}`,
  author: "Penulis",
  format: "PHYSICAL",
  subject: overrides.subject ?? null,
  grade: overrides.grade ?? null,
  categoryId: overrides.categoryId ?? null,
});

describe("gradeFromClass", () => {
  it("parses common class formats", () => {
    expect(gradeFromClass("XII IPA 1")).toBe("XII");
    expect(gradeFromClass("xi tkj 2")).toBe("XI");
    expect(gradeFromClass("X")).toBe("X");
  });

  it("returns null when no grade is present", () => {
    expect(gradeFromClass(null)).toBeNull();
    expect(gradeFromClass("")).toBeNull();
    expect(gradeFromClass("9A")).toBeNull();
  });
});

describe("getRecommendationsForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("excludes books the user is currently borrowing and ranks by relevance", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ class: "XII IPA 1" });

    (prisma.borrowRecord.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { book: { subject: "Matematika", categoryId: "c1", grade: null } },
      ])
      .mockResolvedValueOnce([{ bookId: "active-1" }]);

    (prisma.book.findMany as jest.Mock).mockResolvedValueOnce([
      book("b1", { subject: "Fisika", grade: "XII" }), // skor 1 (kelas)
      book("b2", { subject: "Matematika" }), // skor 3 (mapel)
      book("b3", { categoryId: "c1" }), // skor 2 (kategori)
    ]);

    const result = await getRecommendationsForUser("stu-1", 3);

    expect(result.map((r) => r.id)).toEqual(["b2", "b3", "b1"]);

    // Kueri kandidat harus mengecualikan buku yang sedang dipinjam.
    const candidateQuery = (prisma.book.findMany as jest.Mock).mock.calls[0][0];
    expect(candidateQuery.where.id.notIn).toContain("active-1");
    expect(candidateQuery.where.OR).toEqual(
      expect.arrayContaining([
        { subject: { in: ["Matematika"] } },
        { categoryId: { in: ["c1"] } },
        { grade: "XII" },
      ])
    );
  });

  it("falls back to the latest catalog entries when the user has no history", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ class: null });
    (prisma.borrowRecord.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // history
      .mockResolvedValueOnce([]); // active

    (prisma.book.findMany as jest.Mock).mockResolvedValueOnce([
      book("n1"),
      book("n2"),
    ]);

    const result = await getRecommendationsForUser("stu-2", 3);

    expect(result.map((r) => r.id)).toEqual(["n1", "n2"]);
    // Tanpa sinyal, kueri kandidat berbasis sinyal tidak dijalankan.
    expect((prisma.book.findMany as jest.Mock).mock.calls).toHaveLength(1);
  });
});
