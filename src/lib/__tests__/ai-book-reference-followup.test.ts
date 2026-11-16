/**
 * Regresi: resolusi rujukan buku spesifik pada percakapan lanjutan.
 * Fokus: follow-up properti ("penulisnya/stoknya/tersedia/tahun/detail")
 * harus terikat ke buku (ID) dari hasil sebelumnya, bukan pencarian umum.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    book: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    category: { findMany: jest.fn(), count: jest.fn() },
    borrowRecord: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    ebookLoan: { findMany: jest.fn() },
    notification: { findMany: jest.fn(), count: jest.fn() },
    auditLog: { findMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: jest.fn(async () => ({ chat: jest.fn() })),
  isAIConfigured: jest.fn(async () => false),
}));

import { prisma } from "@/lib/prisma";
import { processChat, resetRateLimits } from "@/lib/ai/pipeline";
import type { AIChatMessage } from "@/lib/ai/types";

const mockUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockBookFindFirst = prisma.book.findFirst as jest.Mock;

const bumiManusiaRow = {
  id: "book-bumi",
  title: "Bumi Manusia",
  author: "Pramoedya Ananta Toer",
  publisher: "Hasta Mitra",
  year: 1980,
  isbn: "978-979-97312-3-4",
  description: "Novel sejarah.",
  stock: 5,
  grade: null,
  subject: "Bahasa Indonesia",
  major: null,
  format: "PHYSICAL",
  coverUrl: null,
  category: { name: "Fiksi" },
  _count: { borrows: 0 },
};

function account(role = "STUDENT") {
  return { name: "Tester", role, gender: null, class: null, isActive: true };
}

function assistantWithRefs(content: string, refs: any[]): AIChatMessage {
  return { role: "assistant", content, references: refs } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  mockUserFindUnique.mockResolvedValue(account("STUDENT"));
  mockBookFindFirst.mockResolvedValue(bumiManusiaRow);
});

describe("answerFocusedBookFollowUp (via processChat)", () => {
  it("merujuk ke buku spesifik terakhir untuk pertanyaan penulis/stok/tersedia/tahun", async () => {
    const history: AIChatMessage[] = [
      { role: "user", content: "Ada berapa buku kategori Fiksi?" },
      assistantWithRefs("Terdapat 1 judul buku fisik dalam kategori Fiksi.", [
        { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
      ]),
      { role: "user", content: "Apa judulnya?" },
      assistantWithRefs('Ditemukan 1 judul buku untuk "fiksi":\n\n- Bumi Manusia — Pramoedya Ananta Toer (tersedia 5)', [
        { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
      ]),
      { role: "user", content: "Berikan detail buku tersebut." },
      assistantWithRefs("**Bumi Manusia**\nPenulis: Pramoedya Ananta Toer", [
        { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
      ]),
    ];

    const cases = [
      { q: "Siapa penulisnya?", expect: /Pramoedya Ananta Toer/i },
      { q: "Stoknya berapa?", expect: /total 5|tersedia 5/i },
      { q: "Apakah buku tersebut masih tersedia?", expect: /tersedia 5/i },
      { q: "Diterbitkan tahun berapa?", expect: /1980/ },
    ];

    for (const c of cases) {
      mockBookFindFirst.mockClear();
      mockBookFindFirst.mockResolvedValue(bumiManusiaRow);
      const res = await processChat({
        userId: "u1",
        messages: [...history, { role: "user", content: c.q }],
      });
      expect(res.verified).toBe(true);
      expect(res.message).toMatch(c.expect);
      expect(res.message).not.toMatch(/Fisika Dasar/i);
      expect(mockBookFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: "book-bumi" }) })
      );
    }
  });

  it("meminta klarifikasi bila ada beberapa buku dalam konteks dan rujukan ambigu", async () => {
    const history: AIChatMessage[] = [
      { role: "user", content: "Buku apa saja yang tersedia?" },
      assistantWithRefs("Ditemukan 2 judul buku.", [
        { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
        { id: "book-fisika", title: "Fisika Dasar untuk SMA", author: "Yohanes Surya" },
      ]),
    ];
    const res = await processChat({
      userId: "u1",
      messages: [...history, { role: "user", content: "Siapa penulisnya?" }],
    });
    expect(res.intent).toBe("CLARIFY");
    expect(res.message).toMatch(/Buku mana yang Anda maksud/i);
    expect(mockBookFindFirst).not.toHaveBeenCalled();
  });

  it("dapat menargetkan satu buku bila judul disebut saat konteks memiliki beberapa buku", async () => {
    const history: AIChatMessage[] = [
      { role: "user", content: "Buku apa saja yang tersedia?" },
      assistantWithRefs("Ditemukan 2 judul buku.", [
        { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
        { id: "book-fisika", title: "Fisika Dasar untuk SMA", author: "Yohanes Surya" },
      ]),
    ];
    mockBookFindFirst.mockResolvedValue(bumiManusiaRow);
    const res = await processChat({
      userId: "u1",
      messages: [...history, { role: "user", content: "Siapa penulis buku Bumi Manusia?" }],
    });
    expect(res.verified).toBe(true);
    expect(res.message).toMatch(/Pramoedya Ananta Toer/i);
    expect(res.message).not.toMatch(/Yohanes Surya/i);
  });

  it("tidak membocorkan konteks buku antar request/session terpisah (riwayat in-request)", async () => {
    // Session/request A: membahas Bumi Manusia
    const sessionA: AIChatMessage[] = [
      { role: "user", content: "Apa judulnya?" },
      assistantWithRefs('Ditemukan 1 judul buku untuk "fiksi":\n\n- Bumi Manusia', [
        { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
      ]),
      { role: "user", content: "Siapa penulisnya?" },
    ];
    const resA = await processChat({ userId: "u1", messages: sessionA });
    expect(resA.message).toMatch(/Pramoedya Ananta Toer/i);

    // Session/request B terpisah (riwayat berbeda, tanpa konteks buku) tidak boleh memakai konteks A.
    mockBookFindFirst.mockClear();
    const sessionB: AIChatMessage[] = [{ role: "user", content: "Siapa penulisnya?" }];
    const resB = await processChat({ userId: "u1", messages: sessionB });
    expect(resB.message).not.toMatch(/Bumi Manusia|Pramoedya Ananta Toer/i);
    expect(mockBookFindFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "book-bumi" }) })
    );
    // Tanpa konteks di request ini, jawaban tidak boleh menebak buku (klarifikasi/keterbatasan aman diterima).
    expect(resB.verified).toBe(true);
  });
});

describe("pergantian topik tidak dipaksa ke buku fokus", () => {
  it("pertanyaan identitas diri tetap dijawab sebagai profil, bukan properti buku", async () => {
    mockUserFindUnique.mockResolvedValue({
      name: "Siswa Rajin",
      role: "STUDENT",
      gender: null,
      class: "XII IPA 1",
      isActive: true,
      email: "siswa@sma.id",
      identityNumber: "2024001",
    });
    // prisma.user.findUnique dipakai loadAccount (select subset) dan answerPersonal MY_PROFILE (select beda).
    // Untuk kesederhanaan mock mengembalikan gabungan field.
    const history: AIChatMessage[] = [
      assistantWithRefs("Detail Bumi Manusia", [
        { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
      ]),
      { role: "user", content: "Siapa saya?" },
    ];
    const res = await processChat({ userId: "u1", messages: history });
    expect(res.intent).toBe("MY_PROFILE");
    expect(res.verified).toBe(true);
    expect(res.message).toMatch(/Siswa Rajin/);
  });
});
