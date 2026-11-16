/**
 * AI Chat — Tool-calling (fungsi yang bisa dipanggil model).
 *
 * Memastikan setiap fungsi mengembalikan data database aktual (bukan
 * hardcode), dibatasi ke userId yang sah, dan kegagalan query dikembalikan
 * sebagai pesan error — bukan hasil kosong yang menyesatkan.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    borrowRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
    ebookLoan: { findMany: jest.fn(), count: jest.fn() },
    finePayment: { aggregate: jest.fn() },
    category: { count: jest.fn() },
    notification: { findMany: jest.fn() },
    user: { findUnique: jest.fn(), count: jest.fn() },
    setting: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { ALL_TOOLS, toolsForRole, executeTool } from "@/lib/ai/tools";

const mockBookFindMany = prisma.book.findMany as jest.Mock;
const mockBookCount = prisma.book.count as jest.Mock;
const mockBorrowFindMany = prisma.borrowRecord.findMany as jest.Mock;
const mockBorrowCount = prisma.borrowRecord.count as jest.Mock;
const mockBorrowGroupBy = prisma.borrowRecord.groupBy as jest.Mock;
const mockBorrowAggregate = prisma.borrowRecord.aggregate as jest.Mock;
const mockFineAggregate = prisma.finePayment.aggregate as jest.Mock;
const mockCategoryCount = prisma.category.count as jest.Mock;
const mockEbookFindMany = prisma.ebookLoan.findMany as jest.Mock;
const mockEbookCount = prisma.ebookLoan.count as jest.Mock;
const mockNotificationFindMany = prisma.notification.findMany as jest.Mock;
const mockUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockSettingFindMany = prisma.setting.findMany as jest.Mock;

const USER_ID = "user-siswa";

/** Role per skenario pengujian (sesuai matriks izin di access.ts). */
const STUDENT = "STUDENT";
const TEACHER = "TEACHER";
const LIBRARIAN = "LIBRARIAN";
const ADMIN = "ADMIN";

function bookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "book-1",
    title: "Fisika Dasar untuk SMA",
    author: "Yohanes Surya",
    publisher: "Erlangga",
    year: 2021,
    isbn: "978-1",
    description: "Buku teks fisika.",
    stock: 10,
    grade: "X",
    subject: "Fisika",
    major: null,
    format: "PHYSICAL",
    coverUrl: null,
    category: { name: "Buku Teks Pelajaran" },
    _count: { borrows: 0 },
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("ALL_TOOLS — definisi dan role", () => {
  it("mendefinisikan seluruh fitur yang bisa dijawab AI", () => {
    const names = ALL_TOOLS.map((tool) => tool.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search_books",
        "list_available_books",
        "book_summary",
        "catalog_stats",
        "get_my_loans",
        "get_my_history",
        "get_my_fines",
        "get_my_notifications",
        "get_my_profile",
        "get_all_borrows",
        "get_overdue_borrows",
        "get_fines_overview",
        "get_all_ebook_loans",
        "get_user_count",
        "get_user_stats",
        "get_system_settings",
        "get_user_audit_history",
      ])
    );
  });

  it("Siswa/Guru hanya mendapat tool PERSONAL", () => {
    const names = toolsForRole("STUDENT").map((t) => t.function.name);
    expect(names).toContain("get_my_loans");
    expect(names).toContain("search_books");
    expect(names).not.toContain("get_all_borrows");
    expect(names).not.toContain("get_user_stats");
  });

  it("Pustakawan mendapat PERSONAL + OPERATIONAL", () => {
    const names = toolsForRole("LIBRARIAN").map((t) => t.function.name);
    expect(names).toContain("get_all_borrows");
    expect(names).toContain("get_overdue_borrows");
    expect(names).toContain("get_fines_overview");
    expect(names).not.toContain("get_user_count");
    expect(names).not.toContain("get_user_stats");
    expect(names).not.toContain("get_system_settings");
  });

  it("Admin mendapat semua tool", () => {
    const names = toolsForRole("ADMIN").map((t) => t.function.name);
    expect(names).toContain("get_all_borrows");
    expect(names).toContain("get_user_count");
    expect(names).toContain("get_user_stats");
    expect(names).toContain("get_system_settings");
  });
});

describe("executeTool() — katalog", () => {
  it("search_books mengembalikan hasil query nyata", async () => {
    mockBookFindMany.mockResolvedValue([bookRow()]);

    const result = JSON.parse(await executeTool("search_books", { query: "fisika" }, USER_ID, STUDENT));

    expect(result.count).toBe(1);
    expect(result.books[0].title).toBe("Fisika Dasar untuk SMA");
    expect(mockBookFindMany).toHaveBeenCalledTimes(1);
  });

  it("search_books tanpa kata kunci tidak menyentuh database", async () => {
    const result = JSON.parse(await executeTool("search_books", { query: "   " }, USER_ID, STUDENT));
    expect(result.count).toBe(0);
    expect(mockBookFindMany).not.toHaveBeenCalled();
  });

  it("search_books format=PHYSICAL memfilter katalog buku fisik", async () => {
    mockBookFindMany.mockResolvedValue([bookRow()]);

    await executeTool("search_books", { query: "fisika", format: "PHYSICAL" }, USER_ID, STUDENT);

    const where = mockBookFindMany.mock.calls[0][0].where;
    expect(where.format).toBe("PHYSICAL");
  });

  it("search_books format=EBOOK memfilter katalog ebook", async () => {
    mockBookFindMany.mockResolvedValue([bookRow({ format: "EBOOK" })]);

    await executeTool("search_books", { query: "fisika", format: "EBOOK" }, USER_ID, STUDENT);

    const where = mockBookFindMany.mock.calls[0][0].where;
    expect(where.format).toBe("EBOOK");
  });

  it("list_available_books format=PHYSICAL memfilter buku fisik", async () => {
    mockBookFindMany.mockResolvedValue([bookRow()]);

    await executeTool(
      "list_available_books",
      { limit: 5, format: "PHYSICAL" },
      USER_ID,
      STUDENT
    );

    const where = mockBookFindMany.mock.calls[0][0].where;
    expect(where.format).toBe("PHYSICAL");
  });

  it("list_available_books memakai daftar ketersediaan dari database", async () => {
    mockBookFindMany.mockResolvedValue([bookRow(), bookRow({ id: "book-2", title: "Bumi Manusia" })]);

    const result = JSON.parse(
      await executeTool("list_available_books", { limit: 5 }, USER_ID, STUDENT)
    );

    expect(result.count).toBe(2);
    expect(result.books).toHaveLength(2);
  });

  it("book_summary mengembalikan found:false bila buku tidak ada", async () => {
    const { prisma: p } = jest.requireMock("@/lib/prisma") as { prisma: typeof prisma };
    (p.book.findFirst as jest.Mock).mockResolvedValue(null);

    const result = JSON.parse(await executeTool("book_summary", { query: "judar" }, USER_ID, STUDENT));
    expect(result.found).toBe(false);
  });

  it("book_summary memfilter format ebook bila pengguna meminta ebook", async () => {
    const { prisma: p } = jest.requireMock("@/lib/prisma") as { prisma: typeof prisma };
    (p.book.findFirst as jest.Mock).mockResolvedValue(
      bookRow({ id: "eb1", title: "Fisika (Ebook)", format: "EBOOK" })
    );

    const result = JSON.parse(
      await executeTool("book_summary", { query: "fisika ebook" }, USER_ID, STUDENT)
    );

    expect(result.found).toBe(true);
    const where = (p.book.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where.format).toBe("EBOOK");
  });

  it("catalog_stats mengembalikan statistik terkini", async () => {
    (prisma.book.aggregate as jest.Mock).mockResolvedValue({ _sum: { stock: 15 } });
    mockBookCount.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    mockBorrowCount.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    mockCategoryCount.mockResolvedValue(2);

    const result = JSON.parse(await executeTool("catalog_stats", {}, USER_ID, STUDENT));

    expect(result.totalTitles).toBe(4);
    expect(result.totalEbooks).toBe(2);
    expect(result.totalAvailable).toBe(15);
    expect(result.definitions.totalBorrows).toContain("Tidak termasuk pengajuan");
    expect(result.definitions.totalBorrows).toContain("get_transaction_stats");
  });
});

describe("executeTool() — data pribadi", () => {
  it("get_my_loans dibatasi ke userId dan menggabungkan fisik + ebook", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "BORROWED",
        borrowDate: new Date("2026-10-13T00:00:00Z"),
        dueDate: new Date("2026-10-20T00:00:00Z"),
        returnDate: null,
        book: { title: "Fisika", author: "Yohanes" },
      },
    ]);
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "eb1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-12T00:00:00Z"),
        expiresAt: new Date("2026-10-17T00:00:00Z"),
        returnedAt: null,
        book: { title: "Fisika (Ebook)", author: "Yohanes" },
      },
    ]);

    const result = JSON.parse(await executeTool("get_my_loans", {}, USER_ID, STUDENT));

    // Default: buku fisik saja — EbookLoan TIDAK dikueri.
    expect(result.scope).toBe("PHYSICAL");
    expect(result.activeBorrows).toHaveLength(1);
    expect(result.activeEbooks).toHaveLength(0);
    expect(mockEbookFindMany).not.toHaveBeenCalled();
    // Semua query membawa userId pemilik sesi.
    for (const call of mockBorrowFindMany.mock.calls) {
      expect(call[0].where.userId).toBe(USER_ID);
    }
  });

  it("get_my_loans format=EBOOK hanya membaca EbookLoan", async () => {
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "eb1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-12T00:00:00Z"),
        expiresAt: new Date("2026-10-17T00:00:00Z"),
        returnedAt: null,
        book: { title: "Fisika (Ebook)", author: "Yohanes" },
      },
    ]);

    const result = JSON.parse(
      await executeTool("get_my_loans", { format: "EBOOK" }, USER_ID, STUDENT)
    );

    expect(result.scope).toBe("EBOOK");
    expect(result.activeEbooks).toHaveLength(1);
    expect(result.activeEbooks[0].dueDate).toBeDefined();
    expect(result.activeBorrows).toHaveLength(0);
    // BorrowRecord TIDAK dikueri.
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    for (const call of mockEbookFindMany.mock.calls) {
      expect(call[0].where.userId).toBe(USER_ID);
    }
  });

  it("get_my_loans format=ALL membaca kedua sumber secara terpisah", async () => {
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "eb1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-12T00:00:00Z"),
        expiresAt: new Date("2026-10-17T00:00:00Z"),
        returnedAt: null,
        book: { title: "Fisika (Ebook)", author: "Yohanes" },
      },
    ]);

    const result = JSON.parse(
      await executeTool("get_my_loans", { format: "ALL" }, USER_ID, STUDENT)
    );

    expect(result.scope).toBe("ALL");
    expect(result.activeBorrows).toHaveLength(1);
    expect(result.activeEbooks).toHaveLength(1);
  });

  it("get_my_history menggabungkan riwayat fisik dan ebook", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "h1",
        bookId: "book-1",
        status: "RETURNED",
        borrowDate: new Date("2026-10-01T00:00:00Z"),
        dueDate: new Date("2026-10-08T00:00:00Z"),
        returnDate: new Date("2026-10-05T00:00:00Z"),
        book: { title: "Fisika", author: "Yohanes" },
      },
    ]);
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el2",
        bookId: "eb1",
        status: "EXPIRED",
        borrowedAt: new Date("2026-10-01T00:00:00Z"),
        expiresAt: new Date("2026-10-06T00:00:00Z"),
        returnedAt: null,
        book: { title: "Fisika (Ebook)", author: "Yohanes" },
      },
    ]);

    const physicalOnly = JSON.parse(
      await executeTool("get_my_history", {}, USER_ID, STUDENT)
    );
    expect(physicalOnly.scope).toBe("PHYSICAL");
    expect(physicalOnly.borrows).toHaveLength(1);
    expect(physicalOnly.ebooks).toHaveLength(0);

    const all = JSON.parse(
      await executeTool("get_my_history", { format: "ALL" }, USER_ID, STUDENT)
    );
    expect(all.scope).toBe("ALL");
    expect(all.borrows).toHaveLength(1);
    expect(all.ebooks).toHaveLength(1);
  });

  it("get_my_profile mengembalikan profil pengguna dari database", async () => {
    mockUserFindUnique.mockResolvedValue({
      name: "Siswa Rajin",
      role: "STUDENT",
      class: "XII IPA 1",
      identityNumber: "2024001",
      email: "siswa@sma.id",
    });

    const result = JSON.parse(await executeTool("get_my_profile", {}, USER_ID, STUDENT));

    expect(result.profile.name).toBe("Siswa Rajin");
    expect(result.profile.role).toBe("STUDENT");
    expect(result.profile.class).toBe("XII IPA 1");
    // Password hash tidak pernah dikirim.
    expect(result.profile.passwordHash).toBeUndefined();
  });

  it("get_my_fines menghitung sisa denda dari transaksi", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "f1",
        bookId: "book-1",
        fineAmount: 5000,
        lateFineAmount: 5000,
        damageFineAmount: 0,
        returnCondition: null,
        dueDate: new Date("2026-10-01T00:00:00Z"),
        returnDate: new Date("2026-10-04T00:00:00Z"),
        book: { title: "Fisika", author: "Yohanes" },
        finePayments: [],
      },
    ]);

    const result = JSON.parse(await executeTool("get_my_fines", {}, USER_ID, STUDENT));

    expect(result.totalOutstanding).toBe(5000);
    expect(result.fines[0].status).toBe("UNPAID");
  });

  it("get_my_notifications dibatasi ke userId", async () => {
    mockNotificationFindMany.mockResolvedValue([
      {
        title: "Masa Akses Ebook Habis",
        message: "Akses habis.",
        type: "WARNING",
        isRead: false,
        createdAt: new Date("2026-10-15T00:00:00Z"),
      },
    ]);

    const result = JSON.parse(await executeTool("get_my_notifications", {}, USER_ID, STUDENT));

    expect(result.count).toBe(1);
    expect(mockNotificationFindMany.mock.calls[0][0].where.userId).toBe(USER_ID);
  });
});

describe("executeTool() — operasional (Pustakawan/Admin)", () => {
  it("get_all_borrows mengembalikan transaksi dari seluruh pengguna", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "BORROWED",
        borrowDate: new Date("2026-10-10T00:00:00Z"),
        dueDate: new Date("2026-10-17T00:00:00Z"),
        returnDate: null,
        book: { title: "Fisika", author: "Yohanes" },
        user: { name: "Siswa Rajin", role: "STUDENT", class: "XII IPA 1" },
      },
    ]);

    const result = JSON.parse(await executeTool("get_all_borrows", {}, USER_ID, LIBRARIAN));

    expect(result.count).toBe(1);
    expect(result.borrows[0].userName).toBe("Siswa Rajin");
  });

  it("get_overdue_borrows memfilter buku yang melewati batas", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "o1",
        bookId: "book-1",
        status: "BORROWED",
        dueDate: new Date("2026-10-01T00:00:00Z"),
        borrowDate: new Date("2026-09-24T00:00:00Z"),
        returnDate: null,
        book: { title: "Fisika", author: "Yohanes" },
        user: { name: "Budi", role: "STUDENT", class: null },
      },
    ]);

    const result = JSON.parse(await executeTool("get_overdue_borrows", {}, USER_ID, LIBRARIAN));

    expect(result.count).toBe(1);
    expect(result.overdue[0].userName).toBe("Budi");
    // Filter overdue diterapkan di query: status BORROWED/OVERDUE + dueDate < now.
    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["OVERDUE", "BORROWED"]);
  });

  it("get_overdue_borrows menandai buku arsip dan menyertakan jumlah total", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "o2",
        bookId: "book-arsip",
        status: "OVERDUE",
        dueDate: new Date("2026-10-01T00:00:00Z"),
        borrowDate: new Date("2026-09-24T00:00:00Z"),
        returnDate: null,
        book: {
          id: "book-arsip",
          title: "Ebook Lama",
          author: "Penulis",
          archivedAt: new Date("2026-10-15T09:17:39.490Z"),
        },
        user: { name: "Budi", role: "STUDENT", class: null },
      },
    ]);
    mockBorrowCount.mockResolvedValue(5);

    const result = JSON.parse(await executeTool("get_overdue_borrows", {}, USER_ID, LIBRARIAN));

    expect(result.count).toBe(1);
    expect(result.total).toBe(5);
    expect(result.overdue[0].archived).toBe(true);
    expect(result.overdue[0].userRole).toBe("STUDENT");
    expect(result.overdue[0].bookId).toBe("book-arsip");
    expect(result.overdue[0].dueDate).toContain("WIB");
  });

  it("get_fines_overview menghitung sisa denda keseluruhan", async () => {
    mockBorrowCount.mockResolvedValue(1);
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "f1",
        bookId: "book-1",
        fineAmount: 10000,
        lateFineAmount: 10000,
        damageFineAmount: 0,
        returnCondition: null,
        dueDate: new Date("2026-10-01T00:00:00Z"),
        returnDate: new Date("2026-10-5"),
        book: { title: "Fisika", author: "Yohanes" },
        user: { name: "Siswa Rajin", role: "STUDENT" },
        finePayments: [{ amount: 3000 }],
      },
    ]);

    const result = JSON.parse(await executeTool("get_fines_overview", {}, USER_ID, LIBRARIAN));

    expect(result.count).toBe(1);
    expect(result.totalOutstanding).toBe(7000);
    expect(result.type).toBe("ALL");
    expect(result.fines[0]).toMatchObject({
      title: "Fisika",
      userName: "Siswa Rajin",
      lateAmount: 10000,
      damageAmount: 0,
      outstanding: 7000,
      status: "PARTIAL",
    });
  });

  it("get_fines_overview type=LATE hanya memilih denda keterlambatan", async () => {
    mockBorrowCount.mockResolvedValue(0);
    mockBorrowFindMany.mockResolvedValue([]);

    await executeTool("get_fines_overview", { type: "LATE" }, USER_ID, LIBRARIAN);

    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.fineAmount).toEqual({ gt: 0 });
    expect(where.lateFineAmount).toEqual({ gt: 0 });
    expect(where.damageFineAmount).toBeUndefined();
  });

  it("get_fines_overview type=DAMAGE hanya memilih denda kerusakan", async () => {
    mockBorrowCount.mockResolvedValue(0);
    mockBorrowFindMany.mockResolvedValue([]);

    await executeTool("get_fines_overview", { type: "DAMAGE" }, USER_ID, LIBRARIAN);

    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.damageFineAmount).toEqual({ gt: 0 });
    expect(where.lateFineAmount).toBeUndefined();
  });

  it("get_fines_overview type tak dikenal diperlakukan sebagai ALL (tanpa filter jenis)", async () => {
    mockBorrowCount.mockResolvedValue(0);
    mockBorrowFindMany.mockResolvedValue([]);

    const result = JSON.parse(
      await executeTool("get_fines_overview", { type: "whatever" }, USER_ID, LIBRARIAN)
    );

    expect(result.type).toBe("ALL");
    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.lateFineAmount).toBeUndefined();
    expect(where.damageFineAmount).toBeUndefined();
  });

  it("get_all_ebook_loans mengembalikan seluruh aktifitas ebook", async () => {
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "eb1",
        status: "ACTIVE",
        borrowedAt: new Date("2026-10-12T00:00:00Z"),
        expiresAt: new Date("2026-10-17T00:00:00Z"),
        returnedAt: null,
        book: { title: "Fisika (Ebook)", author: "Yohanes" },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
    ]);

    const result = JSON.parse(await executeTool("get_all_ebook_loans", {}, USER_ID, LIBRARIAN));

    expect(result.count).toBe(1);
    expect(result.loans[0].userName).toBe("Siswa Rajin");
  });

  it("A2: status ebook diturunkan dari timestamp, bukan kolom status yang lazy", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el-expired",
        bookId: "eb-exp",
        status: "ACTIVE", // kolom belum tersinkron
        borrowedAt: past,
        expiresAt: past, // masa akses sudah berakhir
        returnedAt: null,
        book: { title: "Ebook Kedaluwarsa", author: "A" },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
      {
        id: "el-active",
        bookId: "eb-act",
        status: "ACTIVE",
        borrowedAt: new Date(),
        expiresAt: future,
        returnedAt: null,
        book: { title: "Ebook Aktif", author: "B" },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
    ]);

    const result = JSON.parse(await executeTool("get_all_ebook_loans", {}, USER_ID, LIBRARIAN));

    expect(result.loans[0].status).toBe("EXPIRED");
    expect(result.loans[1].status).toBe("ACTIVE");
  });

  it("A2: filter status ebook diterjemahkan ke kondisi timestamp", async () => {
    mockEbookFindMany.mockResolvedValue([]);

    await executeTool("get_all_ebook_loans", { status: "ACTIVE" }, USER_ID, LIBRARIAN);

    const where = mockEbookFindMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
    expect(where.returnedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });
});

describe("executeTool() — jumlah pengguna per role (ADMIN only)", () => {
  const mockUserCount = prisma.user.count as jest.Mock;

  it("get_user_count hanya tersedia untuk ADMIN", () => {
    const librarian = toolsForRole("LIBRARIAN").map((t) => t.function.name);
    const admin = toolsForRole("ADMIN").map((t) => t.function.name);
    const student = toolsForRole("STUDENT").map((t) => t.function.name);
    const teacher = toolsForRole("TEACHER").map((t) => t.function.name);

    expect(librarian).not.toContain("get_user_count");
    expect(admin).toContain("get_user_count");
    expect(student).not.toContain("get_user_count");
    expect(teacher).not.toContain("get_user_count");
  });

  it("get_user_count mengembalikan jumlah per role dan total (tanpa identitas)", async () => {
    // Satu count per role, berurutan ADMIN, LIBRARIAN, TEACHER, STUDENT, STAFF.
    mockUserCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(4);

    const result = JSON.parse(await executeTool("get_user_count", {}, USER_ID, ADMIN));

    expect(result).toEqual({
      totalUsers: 40,
      byRole: { ADMIN: 1, LIBRARIAN: 2, TEACHER: 3, STUDENT: 30, STAFF: 4 },
    });
    // Satu query per role, tanpa daftar/nama pengguna.
    expect(mockUserCount).toHaveBeenCalledTimes(5);
    for (const call of mockUserCount.mock.calls) {
      expect(call[0].where.role).toBeDefined();
    }
    expect(JSON.stringify(result)).not.toContain("@");
  });

  it("get_user_count ditolak untuk LIBRARIAN/STUDENT/TEACHER sebelum menyentuh database", async () => {
    for (const role of [LIBRARIAN, STUDENT, TEACHER, "STAFF"]) {
      const result = JSON.parse(await executeTool("get_user_count", {}, USER_ID, role));
      expect(result.error).toContain("Akses ditolak");
    }
    expect(mockUserCount).not.toHaveBeenCalled();
  });

  it("get_user_count mendukung filter role/status/periode tanpa mengubah bentuk default", async () => {
    mockUserCount.mockResolvedValueOnce(30);

    const byRole = JSON.parse(
      await executeTool("get_user_count", { role: "Siswa" }, USER_ID, ADMIN)
    );
    expect(byRole).toMatchObject({
      totalUsers: 30,
      byRole: { STUDENT: 30 },
    });
    expect(mockUserCount).toHaveBeenCalledTimes(1);
    expect(mockUserCount.mock.calls[0][0].where).toMatchObject({
      role: "STUDENT",
    });

    jest.clearAllMocks();
    mockUserCount.mockResolvedValueOnce(12);

    const active = JSON.parse(
      await executeTool(
        "get_user_count",
        { role: "Siswa", isActive: true },
        USER_ID,
        ADMIN
      )
    );
    expect(active.totalUsers).toBe(12);
    expect(mockUserCount.mock.calls[0][0].where).toMatchObject({
      role: "STUDENT",
      isActive: true,
    });

    jest.clearAllMocks();
    mockUserCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    await executeTool("get_user_count", { period: "this_month" }, USER_ID, ADMIN);
    for (const call of mockUserCount.mock.calls) {
      expect(call[0].where.createdAt.gte).toBeInstanceOf(Date);
      expect(call[0].where.createdAt.lt).toBeInstanceOf(Date);
    }
  });

  it("get_user_count menyatakan error saat query gagal (bukan mengarang angka)", async () => {
    mockUserCount.mockRejectedValueOnce(new Error("db down"));

    const result = JSON.parse(await executeTool("get_user_count", {}, USER_ID, ADMIN));

    expect(result.error).toBe("Pengambilan data gagal. Silakan coba lagi.");
  });

  it("get_user_count memfilter kelas lengkap dan gender", async () => {
    mockUserCount.mockResolvedValueOnce(4);

    const result = JSON.parse(
      await executeTool(
        "get_user_count",
        { role: "Siswa", class: "12 IPA 1", gender: "perempuan" },
        USER_ID,
        ADMIN
      )
    );

    expect(result.totalUsers).toBe(4);
    expect(mockUserCount).toHaveBeenCalledTimes(1);
    expect(mockUserCount.mock.calls[0][0].where).toEqual({
      role: "STUDENT",
      gender: "FEMALE",
      class: "XII IPA 1",
    });
  });

  it("get_user_count memakai awalan untuk kelas tanpa nomor kelas", async () => {
    mockUserCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(0);

    await executeTool("get_user_count", { class: "XII IPA", gender: "male" }, USER_ID, ADMIN);

    for (const call of mockUserCount.mock.calls) {
      expect(call[0].where.gender).toBe("MALE");
      expect(call[0].where.class).toEqual({ startsWith: "XII IPA" });
    }
  });
});

describe("executeTool() — administratif (Admin)", () => {
  it("get_user_stats menghitung pengguna per role", async () => {
    const mockUserCount = prisma.user.count as jest.Mock;
    mockUserCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(2);

    const result = JSON.parse(await executeTool("get_user_stats", {}, USER_ID, ADMIN));

    expect(result.totalUsers).toBe(19);
    expect(result.byRole.STUDENT).toBe(10);
    expect(result.byRole.ADMIN).toBe(1);
  });

  it("get_system_settings hanya membaca key yang diizinkan", async () => {
    mockSettingFindMany.mockResolvedValue([
      { key: "finePerDayIDR", value: "1000" },
    ]);

    const result = JSON.parse(await executeTool("get_system_settings", {}, USER_ID, ADMIN));

    expect(result.settings.finePerDayIDR).toBe("1000");
    // Key sensitif tidak pernah dibaca dari database.
    const where = mockSettingFindMany.mock.calls[0][0].where;
    expect(where.key.in).toEqual(["finePerDayIDR"]);
  });
});

describe("executeTool() — kegagalan dan batas", () => {
  it("fungsi tak dikenal mengembalikan pesan error", async () => {
    const result = JSON.parse(await executeTool("format_harddisk", {}, USER_ID, STUDENT));
    expect(result.error).toContain("tidak tersedia");
  });

  it("kegagalan query database dikembalikan sebagai error, bukan hasil kosong", async () => {
    mockBookFindMany.mockRejectedValue(new Error("database locked"));

    const result = JSON.parse(await executeTool("search_books", { query: "fisika" }, USER_ID, STUDENT));

    expect(result.error).toBe("Pengambilan data gagal. Silakan coba lagi.");
    // Detail teknis tidak bocor ke payload tool.
    expect(JSON.stringify(result)).not.toContain("database locked");
  });
});

describe("executeTool() — otorisasi role di backend (Tahap 4B-1)", () => {
  const mockUserCount = prisma.user.count as jest.Mock;

  it("ADMIN dapat menjalankan tool ADMINISTRATIVE", async () => {
    mockUserCount.mockResolvedValue(1);

    const result = JSON.parse(await executeTool("get_user_stats", {}, USER_ID, ADMIN));

    expect(result.totalUsers).toBe(5);
    expect(result.byRole.ADMIN).toBe(1);
    // Handler benar-benar dijalankan (satu count per role).
    expect(mockUserCount).toHaveBeenCalledTimes(5);
  });

  it("LIBRARIAN dapat menjalankan tool OPERATIONAL", async () => {
    mockBorrowFindMany.mockResolvedValue([]);

    const result = JSON.parse(await executeTool("get_all_borrows", {}, USER_ID, LIBRARIAN));

    expect(result).toHaveProperty("count");
    expect(mockBorrowFindMany).toHaveBeenCalledTimes(1);
  });

  it("LIBRARIAN ditolak pada tool ADMINISTRATIVE dan handler tidak dipanggil", async () => {
    const stats = JSON.parse(await executeTool("get_user_stats", {}, USER_ID, LIBRARIAN));
    expect(stats.error).toContain("Akses ditolak");
    expect(mockUserCount).not.toHaveBeenCalled();

    const settings = JSON.parse(
      await executeTool("get_system_settings", {}, USER_ID, LIBRARIAN)
    );
    expect(settings.error).toContain("Akses ditolak");
    // Tidak ada akses data sama sekali saat izin ditolak.
    expect(mockSettingFindMany).not.toHaveBeenCalled();
  });

  it("STUDENT dan TEACHER ditolak pada tool OPERATIONAL dan handler tidak dipanggil", async () => {
    for (const role of [STUDENT, TEACHER]) {
      const result = JSON.parse(await executeTool("get_all_borrows", {}, USER_ID, role));
      expect(result.error).toContain("Akses ditolak");
    }
    expect(mockBorrowFindMany).not.toHaveBeenCalled();

    const fines = JSON.parse(await executeTool("get_fines_overview", {}, USER_ID, STUDENT));
    expect(fines.error).toContain("Akses ditolak");

    const ebooks = JSON.parse(
      await executeTool("get_all_ebook_loans", {}, USER_ID, TEACHER)
    );
    expect(ebooks.error).toContain("Akses ditolak");
    expect(mockEbookFindMany).not.toHaveBeenCalled();
  });

  it("tool ADMINISTRATIVE juga ditolak bagi STUDENT tanpa akses data", async () => {
    const result = JSON.parse(await executeTool("get_user_stats", {}, USER_ID, STUDENT));
    expect(result.error).toContain("Akses ditolak");
    expect(mockUserCount).not.toHaveBeenCalled();
  });

  it("role tidak valid / tidak tersedia ditolak sebelum handler dijalankan", async () => {
    const roles = ["SUPERUSER", "", undefined as unknown as string];
    for (const role of roles) {
      const result = JSON.parse(
        await executeTool("search_books", { query: "fisika" }, USER_ID, role)
      );
      expect(result.error).toContain("Akses ditolak");
    }
    expect(mockBookFindMany).not.toHaveBeenCalled();
  });

  it("tool PERSONAL tetap dibatasi ke userId pengguna yang sedang login", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookFindMany.mockResolvedValue([]);

    await executeTool("get_my_loans", {}, USER_ID, TEACHER);

    expect(mockBorrowFindMany).toHaveBeenCalled();
    for (const call of mockBorrowFindMany.mock.calls) {
      expect(call[0].where.userId).toBe(USER_ID);
    }
    for (const call of mockEbookFindMany.mock.calls) {
      expect(call[0].where.userId).toBe(USER_ID);
    }
  });
});

describe("executeTool() — peminjam per tanggal (get_borrows_by_date)", () => {
  it("tersedia untuk LIBRARIAN/ADMIN, tidak untuk Siswa/Guru", () => {
    expect(toolsForRole(LIBRARIAN).map((t) => t.function.name)).toContain("get_borrows_by_date");
    expect(toolsForRole(ADMIN).map((t) => t.function.name)).toContain("get_borrows_by_date");
    expect(toolsForRole(STUDENT).map((t) => t.function.name)).not.toContain("get_borrows_by_date");
    expect(toolsForRole(TEACHER).map((t) => t.function.name)).not.toContain("get_borrows_by_date");
  });

  it("mengembalikan transaksi tanggal itu dengan jam WIB dan rentang Jakarta", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        bookId: "book-1",
        status: "RETURNED",
        borrowDate: new Date("2026-10-18T03:32:57.066Z"), // 10:32 WIB
        book: { title: "Bumi Manusia", author: "Pramoedya", archivedAt: null },
        user: { name: "Najla", role: "STUDENT", class: null },
      },
    ]);
    mockEbookFindMany.mockResolvedValue([]);

    const result = JSON.parse(
      await executeTool("get_borrows_by_date", { date: "2026-10-18" }, USER_ID, LIBRARIAN)
    );

    expect(result.count).toBe(1);
    expect(result.borrows[0].userName).toBe("Najla");
    expect(result.borrows[0].borrowDate).toBe("2026-10-18 10:32 WIB");
    expect(result.timeZone).toBe("Asia/Jakarta");
    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.borrowDate.gte.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(where.borrowDate.lt.toISOString()).toBe("2026-10-18T17:00:00.000Z");
    expect(where.status).toEqual({ in: ["BORROWED", "OVERDUE", "RETURNED"] });
  });

  it("memahami kata 'hari ini'/'kemarin' sebagai hari Jakarta", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookFindMany.mockResolvedValue([]);

    const result = JSON.parse(
      await executeTool("get_borrows_by_date", { date: "yesterday" }, USER_ID, LIBRARIAN)
    );

    // Label tanggal selalu konsisten dengan key (YYYY-MM-DD).
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.label).toMatch(/^\d{1,2} \w+ \d{4}$/);
  });

  it("menolak tanggal yang tidak dapat dipahami (bukan menebak)", async () => {
    const result = JSON.parse(
      await executeTool("get_borrows_by_date", { date: "suatu hari" }, USER_ID, LIBRARIAN)
    );

    expect(result.error).toContain("tidak dapat dipahami");
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("menolak parameter date kosong", async () => {
    const result = JSON.parse(await executeTool("get_borrows_by_date", {}, USER_ID, LIBRARIAN));
    expect(result.error).toContain("wajib diisi");
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("ditolak untuk STUDENT sebelum menyentuh database", async () => {
    const result = JSON.parse(
      await executeTool("get_borrows_by_date", { date: "today" }, USER_ID, STUDENT)
    );

    expect(result.error).toContain("Akses ditolak");
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(mockEbookFindMany).not.toHaveBeenCalled();
  });

  it("A2: status ebook pada peminjam per tanggal juga diturunkan dari timestamp", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el-e",
        bookId: "eb-e",
        status: "ACTIVE", // kolom belum tersinkron, padahal sudah berakhir
        borrowedAt: past,
        expiresAt: past,
        returnedAt: null,
        book: { title: "Ebook Lama", author: "A", archivedAt: null },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
      {
        id: "el-a",
        bookId: "eb-a",
        status: "RETURNED",
        borrowedAt: past,
        expiresAt: future,
        returnedAt: past,
        book: { title: "Ebook Kembali", author: "B", archivedAt: null },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
    ]);

    const result = JSON.parse(
      await executeTool("get_borrows_by_date", { date: "2026-10-18" }, USER_ID, LIBRARIAN)
    );

    expect(result.ebookLoans[0].status).toBe("EXPIRED");
    expect(result.ebookLoans[1].status).toBe("RETURNED");
  });
});

describe("get_transaction_stats — pemisahan format", () => {
  beforeEach(() => {
    mockBorrowCount.mockResolvedValue(9);
    mockBorrowGroupBy.mockResolvedValue([]);
    mockBorrowAggregate.mockResolvedValue({ _sum: { fineAmount: 0 } });
    mockFineAggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockEbookCount.mockResolvedValue(4);
  });

  it("default PHYSICAL hanya membaca BorrowRecord", async () => {
    const result = JSON.parse(
      await executeTool("get_transaction_stats", {}, USER_ID, LIBRARIAN)
    );

    expect(result.format).toBe("PHYSICAL");
    expect(result.physical.totalBorrows).toBe(9);
    expect(result.totalBorrows).toBe(9);
    expect(result.ebook).toBeUndefined();
    expect(result.ebookLoans).toBeUndefined();
    expect(mockBorrowCount).toHaveBeenCalled();
    expect(mockEbookCount).not.toHaveBeenCalled();
  });

  it("format EBOOK hanya membaca EbookLoan dan tidak mengembalikan total fisik", async () => {
    const result = JSON.parse(
      await executeTool(
        "get_transaction_stats",
        { format: "EBOOK" },
        USER_ID,
        LIBRARIAN
      )
    );

    expect(result.format).toBe("EBOOK");
    expect(result.ebook.totalLoans).toBe(4);
    expect(result.ebookLoans).toBe(4);
    expect(result.totalBorrows).toBeUndefined();
    expect(result.physical).toBeUndefined();
    expect(mockBorrowCount).not.toHaveBeenCalled();
    expect(mockBorrowGroupBy).not.toHaveBeenCalled();
    expect(mockBorrowAggregate).not.toHaveBeenCalled();
    expect(mockFineAggregate).not.toHaveBeenCalled();
    expect(mockEbookCount).toHaveBeenCalled();
  });

  it("format ALL mengembalikan dua bagian dan total tetap terpisah", async () => {
    const result = JSON.parse(
      await executeTool(
        "get_transaction_stats",
        { format: "ALL" },
        USER_ID,
        LIBRARIAN
      )
    );

    expect(result.format).toBe("ALL");
    expect(result.physical.totalBorrows).toBe(9);
    expect(result.ebook.totalLoans).toBe(4);
    expect(result.totalBorrows).toBe(9);
    expect(result.ebookLoans).toBe(4);
    expect(mockBorrowCount).toHaveBeenCalled();
    expect(mockEbookCount).toHaveBeenCalled();
  });

  it("format kosong/tidak dikenal tidak menjadi ALL", async () => {
    const result = JSON.parse(
      await executeTool(
        "get_transaction_stats",
        { format: "SEMUA" },
        USER_ID,
        LIBRARIAN
      )
    );

    expect(result.format).toBe("PHYSICAL");
    expect(result.physical).toBeDefined();
    expect(result.ebook).toBeUndefined();
    expect(mockEbookCount).not.toHaveBeenCalled();
  });
});

