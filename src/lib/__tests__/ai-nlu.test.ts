/**
 * Hybrid NLU — klasifikasi maksud dengan LLM (divalidasi backend).
 *
 * Fokus:
 * - output JSON valid dipetakan ke intent internal yang sudah ada;
 * - output tidak valid/confidence rendah/gagal → null (fail-safe);
 * - pertanyaan edukatif tetap LEARNING, bukan pencarian database;
 * - parameter hanya primitif (tidak ada objek bebas dari LLM).
 */

const mockChat = jest.fn();

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat }),
}));

import { CLASSIFIER_CLARIFICATION, buildClassifierQuery, classifyIntent } from "@/lib/ai/classifier";
import { detectIntent } from "@/lib/ai/intent";

function json(payload: unknown): string {
  return JSON.stringify(payload);
}

beforeEach(() => {
  mockChat.mockReset();
});

describe("detectIntent() — pertanyaan edukatif", () => {
  it.each([
    "Apa itu buku digital?",
    "Apa yang dimaksud dengan katalog perpustakaan?",
    "Pengertian ebook?",
  ])("tidak mengarahkan '%s' ke pencarian database", (query) => {
    expect(detectIntent(query, false)).toBe("LEARNING");
  });

  it("tetap menolak pertanyaan pemrograman sebagai CODING", () => {
    expect(detectIntent("Apa itu pemrograman?", false)).toBe("CODING");
  });
});

describe("classifyIntent() — pemetaan label", () => {
  it.each([
    ["BOOK_CATALOG", "CATALOG"],
    ["BOOK_AVAILABILITY", "STATS"],
    ["EBOOK_CATALOG", "EBOOK_CATALOG"],
    ["USER_DIRECTORY", "USER_DIRECTORY"],
    ["USER_COUNT", "USER_COUNT"],
    ["OPERATIONAL_LOANS", "OPERATIONAL"],
    ["OPERATIONAL_FINES", "OPERATIONAL"],
    ["MY_FINES", "MY_FINES"],
    ["MY_HISTORY", "MY_HISTORY"],
    ["ACCOUNT_CREATION_DATE", "USER_DIRECTORY"],
    ["AI_MODEL", "CHITCHAT"],
    ["EDUCATIONAL", "LEARNING"],
    ["GENERAL_CHAT", "CHITCHAT"],
  ])("memetakan %s → %s", async (label, expected) => {
    mockChat.mockResolvedValue(
      json({ intent: label, confidence: 0.9, parameters: {}, needsClarification: false })
    );
    const result = await classifyIntent("pertanyaan uji");
    expect(result?.intent).toBe(expected);
    expect(result?.confidence).toBe(0.9);
  });

  it("menerima JSON di dalam pagar markdown", async () => {
    mockChat.mockResolvedValue(
      '```json\n{"intent":"USER_DIRECTORY","confidence":0.8,"parameters":{},"needsClarification":false}\n```'
    );
    await expect(classifyIntent("orang yang punya akun siapa aja")).resolves.toMatchObject({
      intent: "USER_DIRECTORY",
    });
  });

  it("needsClarification=true menghasilkan intent CLARIFY", async () => {
    mockChat.mockResolvedValue(
      json({
        intent: "USER_DIRECTORY",
        confidence: 0.9,
        parameters: {},
        needsClarification: true,
      })
    );
    const result = await classifyIntent("itu siapa?");
    expect(result?.intent).toBe("CLARIFY");
    expect(result?.needsClarification).toBe(true);
  });
});

describe("classifyIntent() — validasi & fail-safe", () => {
  it("confidence rendah → null", async () => {
    mockChat.mockResolvedValue(
      json({ intent: "USER_DIRECTORY", confidence: 0.2, parameters: {}, needsClarification: false })
    );
    await expect(classifyIntent("mungkin pengguna?")).resolves.toBeNull();
  });

  it("JSON tidak valid → null", async () => {
    mockChat.mockResolvedValue("Saya rasa ini tentang pengguna.");
    await expect(classifyIntent("entah")).resolves.toBeNull();
  });

  it("label tidak dikenal → null", async () => {
    mockChat.mockResolvedValue(
      json({ intent: "DROP_TABLES", confidence: 0.99, parameters: {}, needsClarification: false })
    );
    await expect(classifyIntent("hapus semua data")).resolves.toBeNull();
  });

  it("provider gagal → null tanpa melempar", async () => {
    mockChat.mockRejectedValue(new Error("provider down"));
    await expect(classifyIntent("orang yang punya akun siapa aja")).resolves.toBeNull();
  });

  it("output kosong/undefined → null", async () => {
    mockChat.mockResolvedValue(undefined);
    await expect(classifyIntent("halo apa kabar semuanya")).resolves.toBeNull();
  });

  it("hanya meneruskan parameter primitif", async () => {
    mockChat.mockResolvedValue(
      json({
        intent: "USER_DIRECTORY",
        confidence: 0.9,
        parameters: { role: "LIBRARIAN", active: true, limit: 5, nested: { sql: "DROP" } },
        needsClarification: false,
      })
    );
    const result = await classifyIntent("pustakawan siapa saja");
    expect(result?.parameters).toEqual({ role: "LIBRARIAN", active: true, limit: 5 });
    expect(result?.parameters).not.toHaveProperty("nested");
  });

  it("tidak memanggil provider untuk query kosong", async () => {
    await expect(classifyIntent("   ")).resolves.toBeNull();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("menyediakan pesan klarifikasi yang aman", () => {
    expect(CLASSIFIER_CLARIFICATION).toContain("perjelas");
  });
});

describe("classifyIntent() — konteks percakapan", () => {
  it("mengirim riwayat terakhir sebagai konteks, bukan sebagai fakta", async () => {
    mockChat.mockResolvedValue(
      json({ intent: "MY_LOANS", confidence: 0.9, parameters: {}, needsClarification: false })
    );

    await classifyIntent("yang masih aktif ada berapa?", [
      { role: "user", content: "riwayat peminjaman saya" },
      { role: "assistant", content: "Berikut daftar..." },
      { role: "user", content: "yang masih aktif ada berapa?" },
    ]);

    const messages = mockChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("riwayat peminjaman saya");
    expect(messages[1].content).toContain("bukan sumber fakta");
  });
});

describe("buildClassifierQuery() — parameter tervalidasi", () => {
  const base = "tampilkan data";

  it("menerapkan role yang valid pada intent direktori", () => {
    const result = buildClassifierQuery("USER_DIRECTORY", base, { role: "LIBRARIAN" });
    expect(result.applied).toEqual(["role"]);
    expect(result.rejected).toEqual([]);
    expect(result.query).toBe("tampilkan data pustakawan");
  });

  it("menolak role yang tidak dikenal tanpa mengubah query", () => {
    const result = buildClassifierQuery("USER_DIRECTORY", base, { role: "SUPERADMIN" });
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual(["role"]);
    expect(result.query).toBe(base);
  });

  it("mengabaikan role pada intent personal (tidak boleh mengubah scope)", () => {
    const result = buildClassifierQuery("MY_FINES", base, { role: "ADMIN" });
    expect(result.applied).toEqual([]);
    expect(result.ignored).toEqual(["role"]);
    expect(result.query).toBe(base);
  });

  it("menerapkan status akun boolean", () => {
    expect(
      buildClassifierQuery("USER_DIRECTORY", base, { isActive: false }).query
    ).toBe("tampilkan data nonaktif");
  });

  it("menolak status non-boolean", () => {
    const result = buildClassifierQuery("USER_DIRECTORY", base, { isActive: "ya" });
    expect(result.rejected).toEqual(["isActive"]);
  });

  it("menerjemahkan tanggal ISO yang valid dan menolak tanggal mustahil", () => {
    expect(
      buildClassifierQuery("OPERATIONAL", base, { date: "2026-10-17" }).query
    ).toBe("tampilkan data tanggal 17 Oktober 2026");

    expect(
      buildClassifierQuery("OPERATIONAL", base, { date: "2026-02-31" }).rejected
    ).toEqual(["date"]);
  });

  it("menerapkan format dan status transaksi", () => {
    expect(buildClassifierQuery("CATALOG", base, { format: "EBOOK" }).query).toContain("ebook");
    expect(
      buildClassifierQuery("OPERATIONAL", base, { status: "UNPAID" }).query
    ).toContain("belum lunas");
  });

  it("mengabaikan userId/owner dan limit (tidak pernah menjadi filter)", () => {
    const result = buildClassifierQuery("MY_LOANS", base, {
      userId: "user-lain",
      owner: "user-lain",
      limit: 9999,
    });
    expect(result.applied).toEqual([]);
    expect(result.ignored).toEqual(["userId", "owner", "limit"]);
    expect(result.query).toBe(base);
  });

  it("menolak teks pencarian yang mengandung perintah SQL", () => {
    const result = buildClassifierQuery("USER_DIRECTORY", base, {
      search: "Budi; DROP TABLE users",
    });
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual(["search"]);
  });

  it("menerima pencarian nama/email yang wajar", () => {
    expect(
      buildClassifierQuery("USER_DIRECTORY", base, { search: "budi@sma.id" }).query
    ).toBe("tampilkan data budi@sma.id");
  });
});
