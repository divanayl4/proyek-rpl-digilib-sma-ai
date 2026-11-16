/**
 * AI Chat route — konteks katalog untuk pesan lanjutan.
 *
 * Fokus: pesan lanjutan seperti "Yang untuk kelas 11 ada?" harus memakai topik
 * pesan pengguna sebelumnya, sehingga pencarian tetap relevan dan tetap
 * dirender sebagai rekomendasi katalog.
 */

const mockGetServerSession = jest.fn();
const mockChat = jest.fn();
const mockFindMany = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat }),
  isAIConfigured: () => true,
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    book: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: { count: jest.fn() },
    borrowRecord: { count: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/ai/chat/route";

const mockFindUnique = prisma.user.findUnique as jest.Mock;

function chatRequest(messages: unknown) {
  return new Request("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  }) as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "STUDENT" } });
  mockFindUnique.mockResolvedValue({
    name: "Aisyah",
    role: "STUDENT",
    gender: "FEMALE",
    isActive: true,
  });
  mockChat.mockResolvedValue("Berikut rekomendasinya.");
  mockFindMany.mockResolvedValue([]);
});

describe("POST /api/ai/chat — lanjutan katalog", () => {
  it("menggabungkan topik sebelumnya saat pencarian katalog lanjutan", async () => {
    const res = await POST(
      chatRequest([
        { role: "user", content: "Saya ingin belajar jaringan komputer" },
        { role: "assistant", content: "Baik, ada yang bisa saya bantu?" },
        { role: "user", content: "Yang untuk kelas 11 ada?" },
      ]) as never
    );

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalled();

    const where = JSON.stringify(mockFindMany.mock.calls[0][0].where);
    expect(where).toContain("jaringan");
    expect(JSON.stringify(mockFindMany.mock.calls[0][0])).toContain('"XI"');
  });
});