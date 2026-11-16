/**
 * Context resolver — konteks percakapan untuk pertanyaan lanjutan.
 *
 * Konteks hanya memahami maksud/referensi; bukan sumber fakta. Semua data
 * faktual tetap diambil ulang dari database oleh handler pipeline.
 */

import {
  AMBIGUOUS_CONTEXT_CLARIFICATION,
  MISSING_CONTEXT_CLARIFICATION,
  isBareFollowUp,
  resolveConversationContext,
} from "@/lib/ai/contextResolver";
import type { AIChatMessage } from "@/lib/ai/types";

function convo(...contents: string[]): AIChatMessage[] {
  return contents.map((content, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content,
  }));
}

describe("isBareFollowUp()", () => {
  it.each([
    "Siapa saja?",
    "sebutkan namanya",
    "Sebutkan judulnya.",
    "kalau yang belum lunas?",
    "Yang masih aktif ada berapa?",
    "kemarin?",
    "kalau pustakawannya?",
    "bagaimana dengan yang tadi?",
  ])("mengenali lanjutan murni: %s", (query) => {
    expect(isBareFollowUp(query)).toBe(true);
  });

  it.each([
    "Siapa saja pengguna yang terdaftar?",
    "Ada berapa buku kategori teknologi?",
    "Tampilkan riwayat peminjaman Budi",
    "Jelaskan fotosintesis",
  ])("bukan lanjutan murni: %s", (query) => {
    expect(isBareFollowUp(query)).toBe(false);
  });
});

describe("resolveConversationContext() — follow-up dalam intent yang sama", () => {
  it("mewarisi topik peminjaman pribadi tanpa menjadi sumber fakta", () => {
    const result = resolveConversationContext({
      query: "Yang masih aktif ada berapa?",
      messages: convo(
        "Bagaimana riwayat peminjaman saya?",
        "Berikut riwayat peminjamanmu: Buku Fiktif Karya Model.",
        "Yang masih aktif ada berapa?"
      ),
      intent: "CHITCHAT",
      role: "STUDENT",
    });

    expect(result.intent).toBe("MY_HISTORY");
    // Jawaban asisten sebelumnya (judul fiktif) tidak boleh ikut ke query.
    expect(result.query).not.toContain("Buku Fiktif");
    expect(result.query).toBe("Yang masih aktif ada berapa?");
  });

  it("mewarisi topik denda pribadi", () => {
    const result = resolveConversationContext({
      query: "Kalau yang belum lunas?",
      messages: convo("Berapa total denda saya?", "Total denda Anda Rp10.000."),
      intent: "CHITCHAT",
      role: "STUDENT",
    });
    expect(result.intent).toBe("MY_FINES");
    expect(result.query).toBe("Kalau yang belum lunas?");
  });

  it("staf yang bertanya daftar pengguna lalu 'kalau pustakawannya?' tetap USER_DIRECTORY", () => {
    const result = resolveConversationContext({
      query: "Kalau pustakawannya?",
      messages: convo("Siapa saja pengguna yang terdaftar?", "Berikut daftarnya."),
      intent: "USER_DIRECTORY",
      role: "ADMIN",
    });
    expect(result.intent).toBe("USER_DIRECTORY");
    expect(result.query).toContain("pustakawannya");
  });

  it("mewarisi filter tanggal pada topik transaksi milik sendiri", () => {
    const result = resolveConversationContext({
      query: "kalau tanggal 17 Oktober 2026?",
      messages: convo("tampilkan transaksi terbaru", "Berikut transaksi terbaru..."),
      intent: "CHITCHAT",
      role: "STUDENT",
    });
    // Bukan data pihak ketiga: siswa tetap mendapat scope pribadi + tanggal.
    expect(result.intent).toBe("MY_LOANS");
    expect(result.query).toContain("17 Oktober 2026");
  });

  it("staf yang bertanya peminjaman lalu 'siapa saja?' memakai scope operasional", () => {
    const result = resolveConversationContext({
      query: "Siapa saja?",
      messages: convo("Tampilkan riwayat peminjaman semua siswa.", "Berikut datanya."),
      intent: "CHITCHAT",
      role: "LIBRARIAN",
    });
    expect(result.intent).toBe("OPERATIONAL");
    expect(result.query).toContain("peminjaman");
  });

  it("mewarisi filter siswa pada topik pengguna", () => {
    const result = resolveConversationContext({
      query: "Kalau siswa saja?",
      messages: convo("Siapa saja pengguna yang terdaftar?", "Berikut daftarnya."),
      intent: "USER_DIRECTORY",
      role: "ADMIN",
    });
    expect(result.intent).toBe("USER_DIRECTORY");
    expect(result.query).toContain("siswa");
  });
});

describe("resolveConversationContext() — intent baru mengalahkan konteks", () => {
  it("pergantian topik eksplisit tidak membawa konteks lama", () => {
    const result = resolveConversationContext({
      query: "Siapa saja pengguna yang terdaftar?",
      messages: convo("Ada berapa buku kategori teknologi?", "Ada 15 buku."),
      intent: "USER_DIRECTORY",
      role: "ADMIN",
    });
    expect(result.resolved).toBe(false);
    expect(result.intent).toBe("USER_DIRECTORY");
    expect(result.query).toBe("Siapa saja pengguna yang terdaftar?");
  });

  it("'Kemarin?' hanya mewarisi konteks tanggal bila referensinya jelas", () => {
    const clear = resolveConversationContext({
      query: "Kemarin?",
      messages: convo(
        "Tampilkan transaksi peminjaman pada 17 Oktober 2026",
        "Berikut datanya.",
        "Kemarin?"
      ),
      intent: "CHITCHAT",
      role: "LIBRARIAN",
    });
    expect(clear.resolved).toBe(true);
    expect(clear.intent).toBe("OPERATIONAL");
    expect(clear.query).toContain("Kemarin?");

    // Referensi tanggal tidak jelas (topik denda) → jangan menebak tanggal.
    const unclear = resolveConversationContext({
      query: "Kemarin?",
      messages: convo("Berapa total denda saya?", "Total denda Anda Rp10.000.", "Kemarin?"),
      intent: "CHITCHAT",
      role: "STUDENT",
    });
    expect(unclear.intent).toBe("MY_FINES");
    expect(unclear.query).toBe("Kemarin?");
  });

  it("'Kemarin?' tanpa topik sebelumnya meminta klarifikasi, bukan mengarang tanggal", () => {
    const result = resolveConversationContext({
      query: "Kemarin?",
      messages: convo("Halo", "Hai!", "Kemarin?"),
      intent: "CHITCHAT",
      role: "STUDENT",
    });
    expect(result.intent).toBe("CLARIFY");
    expect(result.clarification).toBe(MISSING_CONTEXT_CLARIFICATION);
  });

  it("pertanyaan baru tentang denda tidak mewarisi filter katalog", () => {
    const result = resolveConversationContext({
      query: "Denda yang belum lunas berapa?",
      messages: convo("Ada berapa buku kategori teknologi?", "Ada 15 buku."),
      intent: "CHITCHAT",
      role: "LIBRARIAN",
    });
    // Bukan bare follow-up → intent deterministik dipertahankan (diisi pipeline
    // lewat NLU); konteks buku tidak boleh dipaksakan.
    expect(result.resolved).toBe(false);
    expect(result.query).toBe("Denda yang belum lunas berapa?");
  });

  it("pertanyaan pihak ketiga yang dilanjutkan tidak berubah menjadi data penanya", () => {
    const result = resolveConversationContext({
      query: "kemarin?",
      messages: convo("Tampilkan riwayat peminjaman Budi.", "Berikut data Budi."),
      intent: "CHITCHAT",
      role: "STUDENT",
    });
    expect(result.intent).toBe("OPERATIONAL");
    expect(result.query).toContain("Budi");
  });
});

describe("resolveConversationContext() — klarifikasi", () => {
  it("topik sebelumnya ambigu → minta klarifikasi", () => {
    const result = resolveConversationContext({
      query: "Sebutkan namanya.",
      messages: convo("Berapa buku dan pengguna di perpustakaan?", "Berikut datanya."),
      intent: "CHITCHAT",
      role: "ADMIN",
    });
    expect(result.intent).toBe("CLARIFY");
    expect(result.clarification).toBe(AMBIGUOUS_CONTEXT_CLARIFICATION);
  });

  it("lanjutan tanpa konteks → minta klarifikasi, bukan menebak", () => {
    const result = resolveConversationContext({
      query: "Sebutkan namanya.",
      messages: convo("Sebutkan namanya."),
      intent: "CHITCHAT",
      role: "ADMIN",
    });
    expect(result.intent).toBe("CLARIFY");
    expect(result.clarification).toBe(MISSING_CONTEXT_CLARIFICATION);
  });

  it("intent deterministik yang spesifik tidak diubah menjadi klarifikasi", () => {
    const result = resolveConversationContext({
      query: "Apa saja fitur khusus admin?",
      messages: convo("Apa saja fitur khusus admin?"),
      intent: "ADMIN_CAPABILITIES",
      role: "LIBRARIAN",
    });
    expect(result.intent).toBe("ADMIN_CAPABILITIES");
    expect(result.resolved).toBe(false);
  });
});

describe("resolveConversationContext() — isolasi", () => {
  it("percakapan berbeda menghasilkan konteks berbeda tanpa state bersama", () => {
    const loans = resolveConversationContext({
      query: "Siapa saja?",
      messages: convo("Tampilkan riwayat peminjaman semua siswa.", "Berikut datanya."),
      intent: "CHITCHAT",
      role: "LIBRARIAN",
    });
    const users = resolveConversationContext({
      query: "Siapa saja?",
      messages: convo("Siapa saja pengguna yang terdaftar?", "Berikut datanya."),
      intent: "CHITCHAT",
      role: "LIBRARIAN",
    });

    expect(loans.intent).toBe("OPERATIONAL");
    expect(users.intent).toBe("USER_DIRECTORY");
  });

  it("tidak mengubah payload pesan masukan", () => {
    const messages = convo("Siapa saja pengguna?", "Berikut datanya.", "Siapa saja?");
    const snapshot = JSON.parse(JSON.stringify(messages)) as AIChatMessage[];
    resolveConversationContext({
      query: "Siapa saja?",
      messages,
      intent: "CHITCHAT",
      role: "ADMIN",
    });
    expect(messages).toEqual(snapshot);
  });
});
