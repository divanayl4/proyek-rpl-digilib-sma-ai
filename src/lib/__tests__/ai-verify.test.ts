/**
 * AI Chat — Verifikasi jawaban terhadap katalog
 *
 * Menangkap sebutan judul/ISBN yang tidak ada di DigiLib, tanpa membatalkan
 * seluruh jawaban.
 */

import {
  OUT_OF_SCOPE_REFUSAL,
  collectCatalogEvidence,
  containsInternalPromptLeak,
  enforceNoSourceCode,
  stripInternalMarkers,
  verifyCatalogAnswer,
  verifyModelAnswer,
  verifyNumericClaims,
} from "@/lib/ai/verify";

const titles = ["Fisika Dasar untuk SMA", "Bumi Manusia"];

describe("stripInternalMarkers()", () => {
  it("menghapus penanda BOOK_ID dari jawaban", () => {
    const answer = 'Buku **Bumi Manusia**\n- ID: [BOOK_ID: abc-123]';
    expect(stripInternalMarkers(answer)).toBe("Buku **Bumi Manusia**\n- ID:");
  });

  it("menangani penanda dengan spasi dan huruf besar-kecil", () => {
    expect(stripInternalMarkers("lihat [ book_id : xyz ]")).toBe("lihat");
  });

  it("tidak mengubah jawaban tanpa penanda", () => {
    expect(stripInternalMarkers("Halo")).toBe("Halo");
  });
});

describe("verifyCatalogAnswer()", () => {
  it("menerima jawaban yang hanya memakai judul katalog", () => {
    const answer =
      'Berikut rekomendasinya:\n\n1. **Fisika Dasar untuk SMA**\n   Penulis: Yohanes Surya\n   Stok tersedia: 9 eksemplar';
    expect(verifyCatalogAnswer(answer, titles)).toEqual({
      verified: true,
      unverified: [],
    });
  });

  it("mendeteksi judul asing yang dikarang AI", () => {
    const answer =
      '**1. Fisika Dasar untuk SMA**\n\n**2. Fisika untuk SMA**\n   ISBN: 9786021234567';
    const result = verifyCatalogAnswer(answer, titles);
    expect(result.verified).toBe(false);
    expect(result.unverified).toContain("Fisika untuk SMA");
  });

  it("menangkap ISBN karangan", () => {
    const answer = 'Buku **Fisika Dasar untuk SMA** memiliki ISBN: **9786021234567**.';
    const result = verifyCatalogAnswer(answer, titles);
    expect(result.verified).toBe(false);
    expect(result.unverified.join(" ")).toContain("9786021234567");
  });

  it("menerima judul katalog yang disebut di dalam kalimat lebih panjang", () => {
    const answer =
      "Saya sarankan **Fisika Dasar untuk SMA** karena sesuai dengan kebutuhan Anda.";
    expect(verifyCatalogAnswer(answer, titles).verified).toBe(true);
  });

  it("mengabaikan label pendek dan angka biasa", () => {
    const answer = "**Judul:** apa ya\n\n**Stok:** 9\n\n**ISBN:** —\n\nTersedia sekarang.";
    expect(verifyCatalogAnswer(answer, titles).verified).toBe(true);
  });

  it("mengabaikan markdown bold yang hanya satu kata", () => {
    const answer = "Buku **tersedia** dan **dipinjam** di perpustakaan.";
    expect(verifyCatalogAnswer(answer, titles).verified).toBe(true);
  });

  it("menangani jawaban tanpa katalog dengan benar", () => {
    // Tidak ada buku di konteks, tetapi AI tetap menyebut judul.
    const answer = 'Buku **Kimia Dasar** tidak ada di katalog kami.';
    const result = verifyCatalogAnswer(answer, []);
    expect(result.verified).toBe(false);
  });

  it("mengabaikan perbedaan huruf besar-kecil dan tanda baca", () => {
    const answer = "Cocok dengan **fisika dasar untuk sma**.";
    expect(verifyCatalogAnswer(answer, titles).verified).toBe(true);
  });

  it("mengembalikan daftar unik", () => {
    const answer = "**Buku Awan**\n\n**Buku Awan**\n\n**Buku Awan**";
    const result = verifyCatalogAnswer(answer, titles);
    expect(result.unverified).toEqual(["Buku Awan"]);
  });

  it("tidak menandai frasa kuantitas pada jawaban statistik", () => {
    const answer =
      "Ada **2 judul buku** dengan total **15 eksemplar** di perpustakaan ini.";
    expect(verifyCatalogAnswer(answer, titles).verified).toBe(true);
  });

  it("tidak menandai frasa umum tentang katalog", () => {
    const answer =
      "Anda bisa **mencari buku** di katalog, lalu **buka detail** buku tersebut.";
    expect(verifyCatalogAnswer(answer, titles).verified).toBe(true);
  });

  it("tidak menandai jawaban ringkasan yang sesuai data katalog asli", () => {
    // Regresi: jawaban AI ini dulu salah ditandai, padahal datanya benar.
    const answer = [
      'Berikut informasi lengkap tentang buku **“Bumi Manusia”** yang ada di katalog DigiLib:',
      "",
      "- **Judul:** Bumi Manusia  ",
      "- **Penulis:** Pramoedya Ananta Toer  ",
      "- **Penerbit:** Hasta Mitra  ",
      "- **Tahun Terbit:** 1980  ",
      "- **ISBN:** 9789799731234  ",
      "- **Kategori:** Fiksi  ",
      "- **Stok total:** 5 eksemplar  ",
      "- **Tersedia sekarang:** 4 eksemplar  ",
      "- **Deskripsi singkat:** Buku pertama dari Tetralogi Buru.  ",
      "",
      "Isi lengkap buku tidak tersedia dalam sistem.",
    ].join("\n");

    const result = verifyCatalogAnswer(answer, ["Bumi Manusia"], ["9789799731234"]);
    expect(result).toEqual({ verified: true, unverified: [] });
  });

  it("mengabaikan label formulir yang diakhiri tanda baca", () => {
    const answer = [
      "**Catatan penting:** isi lengkap tidak tersedia.",
      "",
      "**Bumi Manusia** oleh Pramoedya Ananta Toer, ISBN 9789799731234.",
    ].join("\n");
    const result = verifyCatalogAnswer(answer, ["Bumi Manusia"], ["9789799731234"]);
    expect(result).toEqual({ verified: true, unverified: [] });
  });

  it("menangani jawaban kosong tanpa error", () => {
    expect(verifyCatalogAnswer("", titles)).toEqual({ verified: true, unverified: [] });
  });
});

describe("verifyModelAnswer() - bukti query/tool", () => {
  const success = JSON.stringify({
    count: 1,
    books: [{ title: "Bumi Manusia", isbn: "9789799731234" }],
  });

  it("menolak menandai jawaban model tanpa tool sebagai terverifikasi", () => {
    expect(verifyModelAnswer("Jawaban dari pengetahuan model.", [], "CATALOG")).toBe(false);
  });

  it("menerima jawaban yang didukung tool sukses", () => {
    expect(
      verifyModelAnswer(
        "Buku **Bumi Manusia** tersedia.",
        [{ name: "search_books", content: success }],
        "CATALOG"
      )
    ).toBe(true);
  });

  it("menolak jawaban bila tool mengembalikan error/akses ditolak", () => {
    expect(
      verifyModelAnswer(
        "Jawaban model.",
        [
          {
            name: "get_user_count",
            content: JSON.stringify({ error: "Akses ditolak: role Anda tidak berwenang." }),
          },
        ],
        "OPERATIONAL"
      )
    ).toBe(false);
  });

  it("menolak judul yang tidak ada pada bukti tool katalog", () => {
    expect(
      verifyModelAnswer(
        "Buku **Kimia Dasar Modern** tersedia.",
        [{ name: "search_books", content: success }],
        "CATALOG"
      )
    ).toBe(false);
  });

  it("mengumpulkan judul dan ISBN dari payload tool bersarang", () => {
    expect(collectCatalogEvidence([success, JSON.stringify({ loans: [{ title: "Fisika" }] })])).toEqual({
      titles: ["Bumi Manusia", "Fisika"],
      isbns: ["9789799731234"],
    });
  });
});

describe("enforceNoSourceCode()", () => {
  it("mengembalikan jawaban normal apa adanya", () => {
    const answer =
      "Hukum Newton menyatakan bahwa gaya sama dengan massa dikalikan percepatan.";
    expect(enforceNoSourceCode(answer)).toEqual({ answer, blocked: false });
  });

  it("mengganti jawaban yang seluruhnya berisi kode dengan penolakan", () => {
    const code = ['nama = input("Nama: ")', 'print("Halo,", nama)'].join("\n");
    const result = enforceNoSourceCode(code);

    expect(result.blocked).toBe(true);
    expect(result.answer).toBe(OUT_OF_SCOPE_REFUSAL);
    expect(result.answer).not.toContain("print");
  });

  it("membuang blok kode berpagar dan mempertahankan penjelasan", () => {
    const answer = [
      "Program bekerja dengan cara menerima input nama dari pengguna, lalu menampilkan sapaan yang sudah diformat ke layar.",
      "",
      "```python",
      'nama = input("Nama: ")',
      'print("Halo,", nama)',
      "```",
    ].join("\n");

    const result = enforceNoSourceCode(answer);

    expect(result.blocked).toBe(true);
    expect(result.answer).not.toContain("```");
    expect(result.answer).not.toContain("print");
    expect(result.answer).toContain("Program bekerja");
  });

  it("menolak jawaban berpagar yang hampir seluruhnya berisi kode", () => {
    const answer = "Ini programnya:\n```python\nx = 5\ny = 10\nprint(x + y)\n```";
    const result = enforceNoSourceCode(answer);

    expect(result.blocked).toBe(true);
    expect(result.answer).toBe(OUT_OF_SCOPE_REFUSAL);
    expect(result.answer).not.toContain("```");
  });

  it("membuang baris kode tanpa pagaran di tengah penjelasan", () => {
    const answer = [
      "Cara kerjanya sederhana: program membaca input, memproses, lalu menampilkan hasilnya ke layar pengguna.",
      "console.log(nama);",
    ].join("\n");

    const result = enforceNoSourceCode(answer);

    expect(result.blocked).toBe(true);
    expect(result.answer).not.toContain("console.log");
    expect(result.answer).toContain("Cara kerjanya");
  });

  it("mendeteksi program SQL", () => {
    const sql = "SELECT nama FROM siswa WHERE kelas = 'XI';\n";
    const result = enforceNoSourceCode(sql);
    expect(result.blocked).toBe(true);
    expect(result.answer).toBe(OUT_OF_SCOPE_REFUSAL);
  });

  it("tidak menandai rumus matematika sebagai kode", () => {
    const answer = [
      "Rumus yang digunakan adalah F = m × a.",
      "",
      "Langkah pertama, tentukan massa benda dalam kilogram lalu kalikan dengan percepatan gravitasi.",
    ].join("\n");

    expect(enforceNoSourceCode(answer)).toEqual({ answer, blocked: false });
  });

  it("menangani jawaban kosong", () => {
    expect(enforceNoSourceCode("")).toEqual({ answer: "", blocked: false });
  });
});

describe("containsInternalPromptLeak()", () => {
  it("mendeteksi bagian system prompt dalam jawaban", () => {
    expect(containsInternalPromptLeak("ATURAN MUTLAK:\n- Jawab dalam Bahasa Indonesia")).toBe(true);
    expect(
      containsInternalPromptLeak("=== IDENTITAS PENGGUNA (dari akun yang sedang login) ===")
    ).toBe(true);
    expect(containsInternalPromptLeak("=== KONTEKS KATALOG ===")).toBe(true);
  });

  it("tidak menandai jawaban pengguna yang normal", () => {
    expect(containsInternalPromptLeak("Halo Pak Yoga, ada yang bisa saya bantu?")).toBe(false);
    expect(containsInternalPromptLeak("Buku **Fisika Dasar** tersedia di katalog.")).toBe(false);
  });
});

describe("verifyNumericClaims() — klaim angka harus dapat ditelusuri", () => {
  const evidence = [
    {
      name: "get_my_fines",
      content: JSON.stringify({
        totalOutstanding: 10000,
        count: 2,
        fines: [
          { amount: 7500, paid: 2500, outstanding: 5000 },
          { amount: 5000, paid: 0, outstanding: 5000 },
        ],
      }),
    },
  ];

  it("menerima nominal dan jumlah yang benar-benar ada pada payload", () => {
    expect(
      verifyNumericClaims("Total denda Rp10.000 untuk 2 transaksi.", evidence)
    ).toEqual({ supported: true, unsupported: [] });
  });

  it("menerima pemisah ribuan gaya Indonesia", () => {
    const big = [
      { name: "x", content: JSON.stringify({ amount: 1250000 }) },
    ];
    expect(
      verifyNumericClaims("Nominal: Rp1.250.000.", big).supported
    ).toBe(true);
  });

  it("menolak nominal yang tidak ada pada payload (hasil hitung ulang model)", () => {
    const result = verifyNumericClaims("Total denda Rp99.000.", evidence);
    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(["Rp99.000"]);
  });

  it("mengizinkan angka yang berasal dari pertanyaan pengguna (tanggal)", () => {
    expect(
      verifyNumericClaims(
        "Tidak ada transaksi pada 18 Oktober 2026.",
        [{ name: "x", content: JSON.stringify({ total: 0 }) }],
        ["transaksi pada 18 Oktober 2026"]
      ).supported
    ).toBe(true);
  });

  it("mengabaikan penanda daftar bernomor", () => {
    expect(
      verifyNumericClaims("1. Tidak ada data\n2. Coba lagi nanti.", evidence).supported
    ).toBe(true);
  });

  it("verifyModelAnswer menolak angka karangan pada intent faktual", () => {
    expect(
      verifyModelAnswer("Total denda Rp99.000.", evidence, "MY_FINES")
    ).toBe(false);
    expect(
      verifyModelAnswer("Total denda Rp10.000.", evidence, "MY_FINES")
    ).toBe(true);
  });
});