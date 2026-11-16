/**
 * AI Chat — Jawaban data pribadi (pinjaman aktif, riwayat, denda).
 *
 * Dua lapis diuji:
 * 1. Fungsi penyusun jawaban (murni) — memastikan jawaban ringkas, memakai
 *    hanya data yang diberikan, dan tidak mengarang.
 * 2. Fungsi akses data — memastikan query SELALU dibatasi ke userId sesi.
 */

const mockBorrowFindMany = jest.fn();
const mockEbookLoanFindMany = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    borrowRecord: { findMany: (...args: unknown[]) => mockBorrowFindMany(...args) },
    ebookLoan: { findMany: (...args: unknown[]) => mockEbookLoanFindMany(...args) },
  },
}));

import {
  PersonalBorrowItem,
  PersonalEbookLoanItem,
  PersonalFineItem,
  buildLoansAnswer,
  buildHistoryAnswer,
  buildFinesAnswer,
  formatDateID,
  formatRupiah,
  historyPeriod,
  NO_ACTIVE_LOANS,
  NO_HISTORY,
  NO_FINES,
} from "@/lib/ai/personalAnswer";
import {
  getActiveLoans,
  getActiveEbookLoans,
  getEbookHistory,
  getBorrowHistory,
  getPendingRequests,
  getPersonalFines,
  buildPersonalAnswer,
} from "@/lib/ai/personal";

const NOW = new Date("2026-10-15T03:00:00.000Z");

function loan(overrides: Partial<PersonalBorrowItem> = {}): PersonalBorrowItem {
  return {
    id: "borrow-1",
    bookId: "book-1",
    title: "Fisika SMA Kelas X",
    author: "Budi Santoso",
    status: "BORROWED",
    borrowDate: new Date("2026-10-10T00:00:00.000Z"),
    dueDate: new Date("2026-10-17T00:00:00.000Z"),
    returnDate: null,
    daysLate: 0,
    overdue: false,
    ...overrides,
  };
}

function ebookLoan(overrides: Partial<PersonalEbookLoanItem> = {}): PersonalEbookLoanItem {
  return {
    id: "eloan-1",
    bookId: "ebook-1",
    title: "Fisika Dasar untuk SMA (Ebook)",
    author: "Yohanes Surya",
    status: "ACTIVE",
    borrowDate: new Date("2026-10-15T04:00:00.000Z"),
    dueDate: new Date("2026-10-20T04:00:00.000Z"),
    returnDate: null,
    daysRemaining: 5,
    overdue: false,
    ...overrides,
  };
}

function fine(overrides: Partial<PersonalFineItem> = {}): PersonalFineItem {
  return {
    id: "borrow-1",
    bookId: "book-1",
    title: "Fisika SMA Kelas X",
    author: "Budi Santoso",
    amount: 3000,
    lateAmount: 3000,
    damageAmount: 0,
    conditionLabel: null,
    daysLate: 3,
    paid: 0,
    outstanding: 3000,
    status: "UNPAID",
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("buildLoansAnswer()", () => {
  it("menampilkan daftar pinjaman aktif dengan jumlah dan judul", () => {
    const answer = buildLoansAnswer(
      "Buku apa yang sedang saya pinjam?",
      [loan(), loan({ id: "b2", bookId: "book-2", title: "Kimia Dasar" })],
      [],
      NOW
    );
    expect(answer.message).toBe(
      "Kamu sedang meminjam 2 buku fisik:\n\n1. Fisika SMA Kelas X\n2. Kimia Dasar"
    );
    expect(answer.references).toHaveLength(2);
  });

  it("menjawab tidak ada pinjaman aktif bila memang kosong", () => {
    const answer = buildLoansAnswer("Ada berapa buku yang sedang saya pinjam?", [], [], NOW);
    expect(answer.message).toBe("Saat ini kamu tidak memiliki buku fisik yang sedang dipinjam.");
    expect(answer.references).toEqual([]);
  });

  it("menyebutkan pengajuan yang menunggu tanpa menganggapnya aktif", () => {
    const answer = buildLoansAnswer(
      "Tampilkan peminjaman aktif saya.",
      [],
      [loan({ status: "REQUESTED" })],
      NOW
    );
    expect(answer.message).toBe(NO_ACTIVE_LOANS + " Ada 1 pengajuan yang menunggu persetujuan.");
  });

  it("menjawab jatuh tempo satu buku yang disebut pengguna", () => {
    const answer = buildLoansAnswer("Kapan buku Fisika harus dikembalikan?", [loan()], [], NOW);
    expect(answer.message).toBe(`Jatuh tempo Fisika SMA Kelas X adalah ${formatDateID(loan().dueDate)}.`);
  });

  it("melaporkan buku yang terlambat beserta jumlah hari", () => {
    const overdue = loan({ status: "OVERDUE", overdue: true, daysLate: 4 });
    const answer = buildLoansAnswer("Apakah ada buku saya yang terlambat?", [overdue], [], NOW);
    expect(answer.message).toContain("Kamu memiliki 1 buku terlambat");
    expect(answer.message).toContain("terlambat 4 hari");
  });

  it("menjawab tidak ada keterlambatan bila tidak ada", () => {
    const answer = buildLoansAnswer("Apakah ada buku saya yang terlambat?", [loan()], [], NOW);
    expect(answer.message).toBe("Tidak ada buku yang terlambat.");
  });

  it("menjawab jatuh tempo terdekat tanpa kata ganti", () => {
    const answer = buildLoansAnswer(
      "Buku apa yang jatuh temponya paling dekat?",
      [
        loan({ id: "a", bookId: "a", title: "Fisika", dueDate: new Date("2026-10-20T00:00:00.000Z") }),
        loan({ id: "b", bookId: "b", title: "Biologi", dueDate: new Date("2026-10-16T00:00:00.000Z") }),
      ],
      [],
      NOW
    );
    expect(answer.message).toContain("Biologi");
    expect(answer.message).toContain("1 hari lagi");
  });

  it("pertanyaan 'buku' tanpa penanda digital TIDAK menampilkan ebook", () => {
    // Regresi: "Buku apa yang sedang saya pinjam?" pernah menampilkan ebook
    // sebagai buku fisik karena kedua sumber digabung.
    const answer = buildLoansAnswer(
      "Buku apa yang sedang saya pinjam?",
      [loan()],
      [],
      NOW,
      [ebookLoan()]
    );
    expect(answer.message).toContain("Kamu sedang meminjam 1 buku fisik");
    expect(answer.message).toContain("Fisika SMA Kelas X");
    expect(answer.message).not.toContain("Fisika Dasar untuk SMA (Ebook)");
    expect(answer.message).not.toContain("(ebook)");
  });

  it("pertanyaan 'apa saja yang sedang saya pinjam' menampilkan kedua format terpisah", () => {
    const answer = buildLoansAnswer(
      "Apa saja yang sedang saya pinjam?",
      [loan()],
      [],
      NOW,
      [ebookLoan()]
    );
    expect(answer.message).toContain("Buku fisik:");
    expect(answer.message).toContain("Fisika SMA Kelas X");
    expect(answer.message).toContain("Ebook:");
    expect(answer.message).toContain("Fisika Dasar untuk SMA (Ebook)");
  });

  it("judul identik pada dua format tetap ditampilkan sebagai dua format berbeda", () => {
    const answer = buildLoansAnswer(
      "Apa saja yang sedang saya pinjam?",
      [loan({ title: "Fisika Dasar untuk SMA", bookId: "book-phys" })],
      [],
      NOW,
      [ebookLoan({ title: "Fisika Dasar untuk SMA", bookId: "ebook-1" })]
    );
    expect(answer.message).toContain("Buku fisik:");
    expect(answer.message).toContain("Ebook:");
    // Keduanya tampil; tidak ada yang dibuang karena judul sama.
    expect(answer.message.match(/Fisika Dasar untuk SMA/g)?.length).toBe(2);
    expect(answer.references).toHaveLength(2);
  });

  it("mengabaikan buku fisik saat pertanyaan menyebut ebook", () => {
    const answer = buildLoansAnswer(
      "Ebook apa yang sedang saya baca?",
      [loan()],
      [],
      NOW,
      [ebookLoan()]
    );
    expect(answer.message).toContain(
      "Kamu memiliki masa akses aktif untuk ebook Fisika Dasar untuk SMA (Ebook) karya Yohanes Surya."
    );
    expect(answer.message).toContain("berbeda dari aktivitas membaca");
  });

  it("menjawab tidak ada ebook aktif dengan pesan khusus", () => {
    const answer = buildLoansAnswer("Ebook apa yang sedang saya baca?", [], [], NOW, []);
    expect(answer.message).toBe(
      "Saat ini kamu tidak memiliki ebook dengan masa akses aktif."
    );
  });

  it("menjawab kapan masa akses ebook dimulai dari borrowedAt", () => {
    const answer = buildLoansAnswer("Sejak kapan saya meminjam ebook?", [], [], NOW, [
      ebookLoan(),
    ]);
    expect(answer.message).toBe(
      `Masa akses ebook Fisika Dasar untuk SMA (Ebook) dimulai pada ${formatDateID(ebookLoan().borrowDate)}.`
    );
  });

  it("menjawab kapan masa akses ebook berakhir", () => {
    const answer = buildLoansAnswer("Kapan masa akses ebook saya berakhir?", [], [], NOW, [
      ebookLoan(),
    ]);
    expect(answer.message).toBe(
      `Masa akses ebook Fisika Dasar untuk SMA (Ebook) berakhir pada ${formatDateID(ebookLoan().dueDate)}.`
    );
  });

  it("menjawab sisa masa akses ebook dalam hari", () => {
    const answer = buildLoansAnswer("Berapa hari lagi masa akses ebook saya habis?", [], [], NOW, [
      ebookLoan({ daysRemaining: 4 }),
    ]);
    expect(answer.message).toBe("Masa akses ebook kamu tersisa 4 hari.");
  });

  it("menjawab apakah masa akses ebook masih aktif", () => {
    const answer = buildLoansAnswer("Apakah masa akses ebook saya masih aktif?", [], [], NOW, [
      ebookLoan(),
    ]);
    expect(answer.message).toContain("Ya, masa akses ebook kamu masih aktif");
    expect(answer.message).toContain("tersisa 5 hari");
  });

  it("menghitung ebook dengan masa akses aktif", () => {
    const answer = buildLoansAnswer(
      "Ada berapa ebook yang sedang saya baca?",
      [],
      [],
      NOW,
      [ebookLoan(), ebookLoan({ id: "e2", bookId: "e2", title: "Biologi Dasar (Ebook)" })]
    );
    expect(answer.message).toContain("Kamu memiliki 2 ebook dengan masa akses aktif.");
    expect(answer.message).toContain("berbeda dari aktivitas membaca");
  });

  it("membuat daftar beberapa ebook dengan masa akses aktif", () => {
    const answer = buildLoansAnswer("Tampilkan semua ebook yang sedang saya pinjam.", [], [], NOW, [
      ebookLoan(),
      ebookLoan({ id: "e2", bookId: "e2", title: "Biologi Dasar (Ebook)", author: "Siti Aminah" }),
    ]);
    expect(answer.message).toContain("Kamu memiliki masa akses aktif untuk 2 ebook:");
    expect(answer.message).toContain("Biologi Dasar (Ebook) karya Siti Aminah");
    expect(answer.message).toContain("berbeda dari aktivitas membaca");
  });

  it("tidak menganggap 'buku fisik' sebagai judul Fisika saat menghitung pinjaman aktif", () => {
    // Regresi: kata "fisik" pernah dipakai sebagai kata kunci judul sehingga
    // hanya buku berjudul "Fisika..." yang dihitung.
    const answer = buildLoansAnswer(
      "Berapa buku fisik yang sedang saya pinjam?",
      [loan(), loan({ id: "b2", bookId: "book-2", title: "Kimia Dasar" })],
      [],
      NOW
    );
    expect(answer.message).toContain("Kamu sedang meminjam 2 buku fisik.");
  });
});

describe("buildHistoryAnswer()", () => {
  const history = [
    loan({
      id: "h1",
      bookId: "b1",
      title: "Fisika",
      status: "RETURNED",
      borrowDate: new Date("2026-09-10T00:00:00.000Z"),
      returnDate: new Date("2026-09-17T00:00:00.000Z"),
    }),
    loan({
      id: "h2",
      bookId: "b2",
      title: "Kimia",
      status: "RETURNED",
      borrowDate: new Date("2026-08-10T00:00:00.000Z"),
      returnDate: new Date("2026-08-17T00:00:00.000Z"),
    }),
    loan({
      id: "h3",
      bookId: "b1",
      title: "Fisika",
      status: "RETURNED",
      borrowDate: new Date("2026-07-10T00:00:00.000Z"),
      returnDate: new Date("2026-07-17T00:00:00.000Z"),
    }),
  ];

  it("menjawab belum ada riwayat bila kosong", () => {
    expect(buildHistoryAnswer("Buku apa saja yang pernah saya pinjam?", [], NOW).message).toBe(
      NO_HISTORY
    );
  });

  it("tidak menganggap 'bacaan' sebagai judul buku", () => {
    // Regresi: "riwayat bacaan saya" pernah dijawab "Tidak, kamu belum pernah
    // meminjam buku bacaan" karena kata umum dianggap judul.
    const message = buildHistoryAnswer("Riwayat bacaan saya", history, NOW).message;
    expect(message).toContain("Fisika");
    expect(message).not.toContain("bacaan");
  });

  it("menghitung jumlah transaksi", () => {
    expect(
      buildHistoryAnswer("Berapa kali saya pernah meminjam buku?", history, NOW).message
    ).toBe("Kamu pernah meminjam 3 transaksi peminjaman.");
  });

  it("membedakan jumlah judul unik dari jumlah transaksi", () => {
    expect(
      buildHistoryAnswer("Ada berapa judul buku yang pernah saya pinjam?", history, NOW).message
    ).toBe("Kamu pernah meminjam 2 judul buku.");
  });

  it("menjawab peminjaman terakhir", () => {
    const message = buildHistoryAnswer("Kapan terakhir kali saya meminjam buku?", history, NOW).message;
    expect(message).toContain("Peminjaman terakhir");
    expect(message).toContain("Fisika");
  });

  it("hanya menampilkan buku yang sudah dikembalikan", () => {
    const message = buildHistoryAnswer("Buku apa yang sudah saya kembalikan?", history, NOW).message;
    expect(message).toContain("Kamu sudah mengembalikan 3 buku");
  });

  it("menyaring riwayat berdasarkan periode bulan ini", () => {
    const recent = [loan({ id: "r1", bookId: "r1", title: "Baru", status: "RETURNED", borrowDate: new Date("2026-10-05T00:00:00.000Z") })];
    const message = buildHistoryAnswer(
      "Tampilkan riwayat peminjaman saya bulan ini.",
      [...history, ...recent],
      NOW
    ).message;
    expect(message).toContain("(bulan ini)");
    expect(message).toContain("Baru");
    expect(message).not.toContain("Kimia");
  });

  it("batas periode memakai zona Asia/Jakarta, bukan waktu lokal server", () => {
    // 2026-11-01 02:00Z = 1 November 2026 pukul 09:00 WIB.
    const now = new Date("2026-11-01T02:00:00.000Z");

    // "bulan ini" dimulai tepat tengah malam 1 November WIB (31 Okt 17:00Z).
    expect(historyPeriod("riwayat peminjaman bulan ini", now).from?.toISOString()).toBe(
      "2026-10-31T17:00:00.000Z"
    );

    // "bulan lalu" = Oktober WIB: [1 Okt 00:00 WIB, 1 Nov 00:00 WIB).
    const lastMonth = historyPeriod("riwayat bulan lalu", now);
    expect(lastMonth.from?.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(lastMonth.to?.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("transaksi awal November WIB tetap dihitung 'bulan ini'", () => {
    const now = new Date("2026-11-01T02:00:00.000Z"); // 1 Nov 09:00 WIB
    const earlyNovWib = new Date("2026-10-31T18:00:00.000Z"); // 1 Nov 01:00 WIB
    const message = buildHistoryAnswer(
      "Tampilkan riwayat peminjaman saya bulan ini.",
      [loan({ id: "r9", bookId: "r9", title: "Awal November", status: "RETURNED", borrowDate: earlyNovWib })],
      now
    ).message;
    expect(message).toContain("(bulan ini)");
    expect(message).toContain("Awal November");
  });

  it("menampilkan riwayat ebook dari transaksi EbookLoan", () => {
    const message = buildHistoryAnswer(
      "Ebook apa saja yang pernah saya baca?",
      [],
      NOW,
      [],
      [ebookLoan({ id: "eh1", bookId: "ebook-1", status: "RETURNED", returnDate: new Date("2026-09-20T00:00:00.000Z") })]
    ).message;
    expect(message).toContain("Riwayat ebook kamu");
    expect(message).toContain("Fisika Dasar untuk SMA (Ebook)");
    expect(message).toContain("sudah dikembalikan");
  });

  it("menghitung transaksi ebook terpisah dari buku fisik", () => {
    const message = buildHistoryAnswer(
      "Berapa ebook yang pernah saya pinjam?",
      history,
      NOW,
      [],
      [ebookLoan({ id: "eh1", bookId: "ebook-1", status: "RETURNED" })]
    ).message;
    expect(message).toBe("Kamu pernah meminjam 1 transaksi ebook.");
  });

  it("menghitung gabungan buku fisik dan ebook secara terpisah", () => {
    const message = buildHistoryAnswer(
      "Berapa kali saya pernah meminjam?",
      [history[0]],
      NOW,
      [],
      [ebookLoan({ id: "eh1", bookId: "ebook-1", status: "RETURNED" })]
    ).message;
    expect(message).toBe(
      "Kamu pernah meminjam 1 transaksi buku fisik dan 1 transaksi ebook."
    );
  });

  it("tidak menganggap 'buku fisik' sebagai judul Fisika", () => {
    // Regresi: "fisik" pernah dianggap kata kunci judul sehingga hanya judul
    // "Fisika..." yang cocok dan siswa dijawab belum pernah meminjam.
    const items = [
      loan({ id: "m1", bookId: "m1", title: "Matematika Wajib", status: "RETURNED" }),
      loan({ id: "b1", bookId: "b1", title: "Bahasa Indonesia", status: "RETURNED" }),
    ];
    const message = buildHistoryAnswer(
      "Berapa total riwayat buku fisik saya?",
      items,
      NOW
    ).message;
    expect(message).toBe("Kamu pernah meminjam 2 transaksi peminjaman.");
    expect(message).not.toContain("Tidak, kamu belum pernah");
  });

  it("tetap memakai 'fisika' sebagai kata kunci judul buku", () => {
    const items = [
      loan({ id: "f1", bookId: "f1", title: "Fisika SMA Kelas X", status: "RETURNED" }),
      loan({ id: "k1", bookId: "k1", title: "Kimia Dasar", status: "RETURNED" }),
    ];
    const message = buildHistoryAnswer(
      "Apakah saya pernah meminjam buku fisika?",
      items,
      NOW
    ).message;
    expect(message).toContain("Fisika SMA Kelas X");
    expect(message).not.toContain("Kimia Dasar");
    expect(message).not.toContain("belum pernah meminjam");
  });

  it("pertanyaan 'e-book' memilih sumber data EbookLoan", () => {
    const message = buildHistoryAnswer(
      "Berapa total riwayat e-book saya?",
      [history[0]],
      NOW,
      [],
      [ebookLoan({ id: "eh1", bookId: "ebook-1", status: "RETURNED" })]
    ).message;
    expect(message).toBe("Kamu pernah meminjam 1 transaksi ebook.");
    expect(message).not.toContain("buku fisik");
  });

  it("permintaan seluruh riwayat mengambil buku fisik dan ebook", () => {
    const message = buildHistoryAnswer(
      "Berapa total seluruh riwayat peminjaman saya?",
      [history[0]],
      NOW,
      [],
      [ebookLoan({ id: "eh1", bookId: "ebook-1", status: "RETURNED" })]
    ).message;
    expect(message).toBe(
      "Kamu pernah meminjam 1 transaksi buku fisik dan 1 transaksi ebook."
    );
  });

  it("melaporkan riwayat ebook saja tanpa menyebut 0 transaksi", () => {
    // Regresi: bila hanya ada ebook, cabang gabungan lama melaporkan
    // "0 transaksi peminjaman".
    const message = buildHistoryAnswer(
      "Berapa total seluruh riwayat peminjaman saya?",
      [],
      NOW,
      [],
      [ebookLoan({ id: "eh1", bookId: "ebook-1", status: "RETURNED" })]
    ).message;
    expect(message).toBe("Kamu pernah meminjam 1 transaksi ebook.");
    expect(message).not.toContain("0 transaksi");
  });

  it("menjawab kapan terakhir meminjam ebook dari borrowedAt terbaru", () => {
    const message = buildHistoryAnswer(
      "Kapan terakhir kali saya meminjam ebook?",
      [],
      NOW,
      [],
      [ebookLoan({ id: "eh1", bookId: "ebook-1", borrowDate: new Date("2026-10-15T04:00:00.000Z") })]
    ).message;
    expect(message).toContain("Terakhir kali kamu meminjam ebook Fisika Dasar untuk SMA (Ebook)");
    expect(message).toContain(formatDateID(new Date("2026-10-15T04:00:00.000Z")));
  });

  it("menampilkan ebook aktif dengan label masa akses saat riwayat diminta", () => {
    const message = buildHistoryAnswer(
      "Ebook apa saja yang pernah saya baca?",
      [],
      NOW,
      [],
      [ebookLoan({ status: "ACTIVE", dueDate: new Date("2026-10-25T00:00:00.000Z") })]
    ).message;
    expect(message).toContain("Riwayat ebook kamu");
    expect(message).toContain("masa akses aktif");
    expect(message).not.toContain("sedang dibaca");
    expect(message).toContain("berbeda dari aktivitas membaca");
  });

  it("menjawab belum pernah membaca ebook bila tidak ada transaksi", () => {
    const message = buildHistoryAnswer("Ebook apa saja yang pernah saya baca?", [], NOW, [], []).message;
    expect(message).toBe("Kamu belum pernah meminjam ebook.");
  });
});

describe("buildFinesAnswer()", () => {
  it("menjawab tidak punya denda bila kosong", () => {
    expect(buildFinesAnswer("Apakah saya punya denda?", []).message).toBe(NO_FINES);
  });

  it("menyebutkan total denda yang belum dibayar", () => {
    const message = buildFinesAnswer("Berapa denda yang belum dibayar?", [fine()]).message;
    expect(message).toBe(`Total denda yang belum dibayar adalah ${formatRupiah(3000)}.`);
  });

  it("membedakan lunas dan sebagian", () => {
    const message = buildFinesAnswer("Status pembayaran denda saya?", [
      fine({ id: "f1", bookId: "f1", title: "Fisika", status: "PAID", outstanding: 0, paid: 3000 }),
      fine({ id: "f2", bookId: "f2", title: "Kimia", status: "PARTIAL", outstanding: 1000, paid: 2000 }),
    ]).message;
    expect(message).toContain("Fisika: lunas");
    expect(message).toContain("Kimia: dibayar sebagian");
    expect(message).toContain(formatRupiah(1000));
  });

  it("menjelaskan penyebab denda dari keterlambatan dan kerusakan", () => {
    const message = buildFinesAnswer("Apa penyebab denda saya?", [
      fine({ lateAmount: 2000, damageAmount: 5000, conditionLabel: "Kerusakan ringan", daysLate: 2 }),
    ]).message;
    expect(message).toContain("keterlambatan 2 hari");
    expect(message).toContain("kerusakan: Kerusakan ringan");
  });

  it("menyatakan semua denda lunas bila sisa nol", () => {
    const message = buildFinesAnswer("Apakah semua denda saya sudah lunas?", [
      fine({ status: "PAID", outstanding: 0, paid: 3000 }),
    ]).message;
    expect(message).toBe("Semua denda kamu sudah lunas.");
  });
});

describe("akses data pribadi", () => {
  it("membatasi pinjaman aktif ke userId milik sesi", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "BORROWED",
        borrowDate: new Date("2026-10-10T00:00:00.000Z"),
        dueDate: new Date("2026-10-17T00:00:00.000Z"),
        returnDate: null,
        book: { title: "Fisika", author: "Budi" },
      },
    ]);

    const items = await getActiveLoans("user-siswa");

    expect(mockBorrowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-siswa", status: { in: ["BORROWED", "OVERDUE"] } },
      })
    );
    expect(items[0].title).toBe("Fisika");
  });

  it("tidak menghitung pengajuan sebagai peminjaman aktif", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    await getActiveLoans("user-siswa");
    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.status.in).not.toContain("REQUESTED");
  });

  it("membatasi riwayat ke transaksi nyata milik userId", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    await getBorrowHistory("user-guru");
    const call = mockBorrowFindMany.mock.calls[0][0];
    expect(call.where.userId).toBe("user-guru");
    expect(call.where.status.in).toEqual(["BORROWED", "OVERDUE", "RETURNED"]);
  });

  it("mengambil pengajuan yang menunggu persetujuan", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    await getPendingRequests("user-siswa");
    expect(mockBorrowFindMany.mock.calls[0][0].where).toEqual({
      userId: "user-siswa",
      status: "REQUESTED",
    });
  });

  it("batasi ebook aktif ke userId, belum dikembalikan, dan masa akses belum habis", async () => {
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        borrowedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        returnedAt: null,
        book: { title: "Fisika Dasar untuk SMA (Ebook)", author: "Yohanes Surya" },
      },
    ]);

    const items = await getActiveEbookLoans("user-siswa");

    expect(mockEbookLoanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-siswa",
          returnedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("ACTIVE");
    expect(items[0].title).toBe("Fisika Dasar untuk SMA (Ebook)");
    expect(items[0].daysRemaining).toBe(5);
  });

  it("tidak menganggap ebook kedaluwarsa sebagai aktif walau kolomnya ACTIVE", async () => {
    mockEbookLoanFindMany.mockResolvedValue([]);
    await getActiveEbookLoans("user-siswa");
    const where = mockEbookLoanFindMany.mock.calls[0][0].where;
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    // expiresAt > now menolak loan yang waktunya sudah lewat.
    expect(where.expiresAt.gt.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("tidak menyaring ebook aktif berdasarkan kolom status", async () => {
    // Regresi: filter kolom status bisa menyembunyikan loan yang menurut
    // aturan akses (getEbookAccessState) masih aktif — mis. baris yang kolom
    // statusnya belum tersinkron. Aturannya murni timestamp.
    mockEbookLoanFindMany.mockResolvedValue([]);
    await getActiveEbookLoans("user-siswa");
    const where = mockEbookLoanFindMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });

  it("tidak mengambil ebook yang masih aktif sebagai riwayat", async () => {
    mockEbookLoanFindMany.mockResolvedValue([]);
    await getEbookHistory("user-siswa");
    const where = mockEbookLoanFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe("user-siswa");
    // Loan aktif (returnedAt null DAN expiresAt > now) tidak memenuhi OR.
    expect(where.OR).toEqual([
      { returnedAt: { not: null } },
      { expiresAt: { lte: expect.any(Date) } },
    ]);
  });

  it("menghitung status ebook kedaluwarsa dari timestamp walau kolom ACTIVE", async () => {
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-06T04:00:00.000Z"),
        expiresAt: new Date("2026-10-11T04:00:00.000Z"),
        returnedAt: null,
        book: { title: "Lama (Ebook)", author: "Penulis" },
      },
    ]);

    const items = await getEbookHistory("user-siswa");
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("EXPIRED");
    expect(items[0].overdue).toBe(true);
  });

  it("mengambil ebook yang sudah dikembalikan sebagai riwayat", async () => {
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        status: "RETURNED",
        borrowedAt: new Date("2026-10-01T04:00:00.000Z"),
        expiresAt: new Date("2026-10-20T04:00:00.000Z"),
        returnedAt: new Date("2026-10-10T04:00:00.000Z"),
        book: { title: "Selesai (Ebook)", author: "Penulis" },
      },
    ]);

    const items = await getEbookHistory("user-siswa");
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("RETURNED");
  });

  it("menghitung sisa denda dari pembayaran aktual", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "f1",
        bookId: "book-1",
        fineAmount: 3000,
        lateFineAmount: 3000,
        damageFineAmount: 0,
        returnCondition: "GOOD",
        dueDate: new Date("2026-10-01T00:00:00.000Z"),
        returnDate: new Date("2026-10-04T00:00:00.000Z"),
        book: { title: "Fisika", author: "Budi" },
        finePayments: [{ amount: 1000 }],
      },
    ]);

    const [item] = await getPersonalFines("user-siswa");
    expect(mockBorrowFindMany.mock.calls[0][0].where).toEqual({
      userId: "user-siswa",
      fineAmount: { gt: 0 },
    });
    expect(item.outstanding).toBe(2000);
    expect(item.status).toBe("PARTIAL");
    expect(item.daysLate).toBe(3);
  });
});

describe("buildPersonalAnswer()", () => {
  it("menyusun jawaban pinjaman aktif dari database", async () => {
    mockBorrowFindMany
      .mockResolvedValueOnce([
        {
          id: "b1",
          bookId: "book-1",
          status: "BORROWED",
          borrowDate: new Date("2026-10-10T00:00:00.000Z"),
          dueDate: new Date("2026-10-17T00:00:00.000Z"),
          returnDate: null,
          book: { title: "Fisika", author: "Budi" },
        },
      ])
      .mockResolvedValueOnce([]);
    mockEbookLoanFindMany.mockResolvedValue([]);

    const answer = await buildPersonalAnswer("MY_LOANS", "Buku apa yang sedang saya pinjam?", "user-1");
    expect(answer.message).toContain("Kamu sedang meminjam 1 buku");
    expect(answer.message).toContain("Fisika");
  });

  it("hanya menampilkan ebook bila pertanyaan menyebut ebook", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-15T04:00:00.000Z"),
        expiresAt: new Date("2026-10-20T04:00:00.000Z"),
        returnedAt: null,
        book: { title: "Fisika Dasar untuk SMA (Ebook)", author: "Yohanes Surya" },
      },
    ]);

    const answer = await buildPersonalAnswer(
      "MY_LOANS",
      "Ebook apa yang sedang saya pinjam?",
      "user-1"
    );
    expect(answer.message).toContain(
      "Kamu memiliki masa akses aktif untuk ebook Fisika Dasar untuk SMA (Ebook) karya Yohanes Surya."
    );
    expect(answer.message).toContain("berbeda dari aktivitas membaca");
  });

  it("pertanyaan 'buku' hanya query BorrowRecord, tidak menyentuh EbookLoan", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "BORROWED",
        borrowDate: new Date("2026-10-10T00:00:00.000Z"),
        dueDate: new Date("2026-10-17T00:00:00.000Z"),
        returnDate: null,
        book: { title: "Fisika", author: "Budi" },
      },
    ]);
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-15T04:00:00.000Z"),
        expiresAt: new Date("2026-10-20T04:00:00.000Z"),
        returnedAt: null,
        book: { title: "Fisika Dasar untuk SMA (Ebook)", author: "Yohanes Surya" },
      },
    ]);

    const answer = await buildPersonalAnswer(
      "MY_LOANS",
      "Buku apa yang sedang saya pinjam?",
      "user-1"
    );
    expect(answer.message).toContain("Fisika");
    expect(answer.message).not.toContain("Ebook)");
    // Lapisan data: EbookLoan TIDAK dikueri sama sekali.
    expect(mockEbookLoanFindMany).not.toHaveBeenCalled();
  });

  it("pertanyaan 'ebook' hanya query EbookLoan, tidak menyentuh BorrowRecord", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "BORROWED",
        borrowDate: new Date("2026-10-10T00:00:00.000Z"),
        dueDate: new Date("2026-10-17T00:00:00.000Z"),
        returnDate: null,
        book: { title: "Fisika", author: "Budi" },
      },
    ]);
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-15T04:00:00.000Z"),
        expiresAt: new Date("2026-10-20T04:00:00.000Z"),
        returnedAt: null,
        book: { title: "Fisika Dasar untuk SMA (Ebook)", author: "Yohanes Surya" },
      },
    ]);

    const answer = await buildPersonalAnswer(
      "MY_LOANS",
      "Ebook apa yang sedang saya pinjam?",
      "user-1"
    );
    expect(answer.message).toContain("Ebook)");
    expect(answer.message).not.toContain("Budi");
    // Lapisan data: BorrowRecord TIDAK dikueri sama sekali.
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("permintaan semua meminta kedua sumber data", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "BORROWED",
        borrowDate: new Date("2026-10-10T00:00:00.000Z"),
        dueDate: new Date("2026-10-17T00:00:00.000Z"),
        returnDate: null,
        book: { title: "Fisika", author: "Budi" },
      },
    ]);
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-15T04:00:00.000Z"),
        expiresAt: new Date("2026-10-20T04:00:00.000Z"),
        returnedAt: null,
        book: { title: "Fisika Dasar untuk SMA (Ebook)", author: "Yohanes Surya" },
      },
    ]);

    const answer = await buildPersonalAnswer(
      "MY_LOANS",
      "Apa saja yang sedang saya pinjam?",
      "user-1"
    );
    expect(answer.message).toContain("Buku fisik:");
    expect(answer.message).toContain("Ebook:");
    expect(mockBorrowFindMany).toHaveBeenCalled();
    expect(mockEbookLoanFindMany).toHaveBeenCalled();
  });

  it("menjawab ebook dengan masa akses aktif dari database tanpa mengklaim sedang dibaca", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookLoanFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "ebook-1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-15T04:00:00.000Z"),
        expiresAt: new Date("2026-10-20T04:00:00.000Z"),
        returnedAt: null,
        book: { title: "Fisika Dasar untuk SMA (Ebook)", author: "Yohanes Surya" },
      },
    ]);

    const answer = await buildPersonalAnswer("MY_LOANS", "Ebook apa yang sedang saya baca?", "user-1");
    expect(answer.message).toContain(
      "Kamu memiliki masa akses aktif untuk ebook Fisika Dasar untuk SMA (Ebook) karya Yohanes Surya."
    );
    expect(answer.message).toContain("berbeda dari aktivitas membaca");
    expect(answer.message).not.toContain("Kamu sedang membaca ebook");
  });

  it("riwayat e-book hanya membaca EbookLoan, tidak menyentuh BorrowRecord", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookLoanFindMany.mockImplementation(({ where }) => {
      // Hanya query riwayat (OR returned/expired) yang mengembalikan data.
      if (where?.OR) {
        return Promise.resolve([
          {
            id: "el1",
            bookId: "ebook-1",
            status: "RETURNED",
            borrowedAt: new Date("2026-09-01T04:00:00.000Z"),
            expiresAt: new Date("2026-09-20T04:00:00.000Z"),
            returnedAt: new Date("2026-09-10T04:00:00.000Z"),
            book: { title: "Ebook Fisika (Ebook)", author: "Penulis" },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const answer = await buildPersonalAnswer(
      "MY_HISTORY",
      "Berapa total riwayat e-book saya?",
      "user-1"
    );
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(answer.message).toBe("Kamu pernah meminjam 1 transaksi ebook.");
  });

  it("riwayat keseluruhan membaca BorrowRecord dan EbookLoan", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "RETURNED",
        borrowDate: new Date("2026-09-01T04:00:00.000Z"),
        dueDate: new Date("2026-09-08T04:00:00.000Z"),
        returnDate: new Date("2026-09-05T04:00:00.000Z"),
        book: { title: "Fisika", author: "Budi" },
      },
    ]);
    mockEbookLoanFindMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where?.OR
          ? [
              {
                id: "el1",
                bookId: "ebook-1",
                status: "RETURNED",
                borrowedAt: new Date("2026-09-02T04:00:00.000Z"),
                expiresAt: new Date("2026-09-20T04:00:00.000Z"),
                returnedAt: new Date("2026-09-10T04:00:00.000Z"),
                book: { title: "Ebook Fisika (Ebook)", author: "Penulis" },
              },
            ]
          : []
      )
    );

    const answer = await buildPersonalAnswer(
      "MY_HISTORY",
      "Berapa total seluruh riwayat peminjaman saya?",
      "user-1"
    );
    expect(mockBorrowFindMany).toHaveBeenCalled();
    expect(mockEbookLoanFindMany).toHaveBeenCalled();
    expect(answer.message).toBe(
      "Kamu pernah meminjam 1 transaksi buku fisik dan 1 transaksi ebook."
    );
  });
});
