import { mergeCatalogQuery } from "@/lib/ai/catalog";
import { resolveConversationContext } from "@/lib/ai/contextResolver";
import { extractUserLookupTerm } from "@/lib/ai/intent";
import type { AIChatMessage } from "@/lib/ai/types";

function convo(...contents: string[]): AIChatMessage[] {
  return contents.map((content, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content,
  }));
}

describe("Regresi chatbot — follow-up kategori/judul buku", () => {
  it("menggabungkan pertanyaan judul lanjutan dengan konteks kategori sebelumnya", () => {
    const merged = mergeCatalogQuery("Apa judulnya?", [
      "Berapa buku kategori Biologi?",
    ]);

    expect(merged).toContain("Biologi");
    expect(merged).toContain("judul");
  });

  it("menggabungkan permintaan daftar judul dari kategori yang baru dibahas", () => {
    const merged = mergeCatalogQuery(
      "Sebutkan judul buku dari kategori tersebut.",
      ["Tampilkan jumlah buku berdasarkan kategori Biologi."]
    );

    expect(merged).toContain("Biologi");
    expect(merged).toContain("judul");
  });

  it("resolver konteks mengenali lanjutan judul setelah pertanyaan kategori sebagai katalog", () => {
    const result = resolveConversationContext({
      query: "Apa judulnya?",
      messages: convo(
        "Berapa buku kategori Biologi?",
        "Terdapat 2 judul buku fisik dalam kategori Biologi di katalog DigiLib.",
        "Apa judulnya?"
      ),
      intent: "CHITCHAT",
      role: "STUDENT",
    });

    expect(result.resolved).toBe(true);
    expect(result.intent).toBe("CATALOG");
    expect(result.query.toLowerCase()).toContain("biologi");
  });
});

describe("Regresi chatbot — pencarian identitas pengguna admin", () => {
  it("mengambil nama pengguna dari pertanyaan data akun di halaman admin", () => {
    expect(extractUserLookupTerm("Tampilkan data pengguna Budi Santoso di halaman admin")).toBe(
      "budi santoso"
    );
  });

  it("mengambil email pengguna sebagai kata kunci pencarian", () => {
    expect(extractUserLookupTerm("Cek akun budi@example.com")).toBe("budi@example.com");
  });
});
