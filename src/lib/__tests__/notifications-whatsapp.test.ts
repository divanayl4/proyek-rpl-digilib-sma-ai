/**
 * Tests for the WhatsApp notification integration (Fonnte).
 *
 * - Text/format builders must stay identical to the previous notification
 *   behavior (only the delivery channel changed).
 * - The WhatsApp layer is mocked here so no external request is made.
 */

const mockNotificationCreate = jest.fn();
const mockNotificationCreateMany = jest.fn();
const mockUserFindMany = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockBorrowUpdate = jest.fn();
const mockEbookFindMany = jest.fn();
const mockEbookUpdateMany = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: (...args: unknown[]) => mockNotificationCreate(...args),
      createMany: (...args: unknown[]) => mockNotificationCreateMany(...args),
    },
    user: { findMany: (...args: unknown[]) => mockUserFindMany(...args) },
    borrowRecord: {
      findMany: (...args: unknown[]) => mockBorrowFindMany(...args),
      update: (...args: unknown[]) => mockBorrowUpdate(...args),
    },
    ebookLoan: {
      findMany: (...args: unknown[]) => mockEbookFindMany(...args),
      updateMany: (...args: unknown[]) => mockEbookUpdateMany(...args),
    },
  },
}));

const mockDeliver = jest.fn();

jest.mock("@/lib/whatsapp", () => ({
  deliverWhatsAppNotification: (...args: unknown[]) => mockDeliver(...args),
}));

import {
  sendInAppNotification,
  notifyBorrowSuccess,
  buildReturnNotification,
  buildReturnWhatsAppNotification,
  buildFinePaymentNotification,
  notifyReturnSuccess,
  notifyBorrowRejected,
  BORROW_REJECTED_TITLE,
  buildBorrowRejectedMessage,
  processUpcomingDueNotifications,
  processOverdueNotifications,
  processEbookExpiryNotifications,
  notifyNewBook,
} from "@/lib/notifications";

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificationCreate.mockResolvedValue({});
  mockNotificationCreateMany.mockResolvedValue({ count: 0 });
  mockUserFindMany.mockResolvedValue([]);
  mockDeliver.mockResolvedValue({ sent: true });
});

describe("sendInAppNotification — WhatsApp forwarding", () => {
  it("creates the in-app row and forwards identical text when eventKey is given", async () => {
    await sendInAppNotification(
      "u1",
      "Peminjaman Berhasil",
      'Buku "Buku A" berhasil dipinjam.',
      "SUCCESS",
      "/student/borrows",
      { eventKey: "borrow:approve:b1", category: "BORROW" }
    );

    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        title: "Peminjaman Berhasil",
        message: 'Buku "Buku A" berhasil dipinjam.',
        type: "SUCCESS",
        link: "/student/borrows",
      },
    });

    expect(mockDeliver).toHaveBeenCalledWith({
      userId: "u1",
      title: "Peminjaman Berhasil",
      message: 'Buku "Buku A" berhasil dipinjam.',
      eventKey: "borrow:approve:b1",
      category: "BORROW",
    });
  });

  it("defaults the category to ACCOUNT when not supplied", async () => {
    await sendInAppNotification("u1", "T", "M", "INFO", undefined, { eventKey: "k" });
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: "k", category: "ACCOUNT" })
    );
  });

  it("does not forward to WhatsApp without an eventKey", async () => {
    await sendInAppNotification("u1", "T", "M");
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it("still creates the in-app row even if WhatsApp delivery fails", async () => {
    mockDeliver.mockRejectedValueOnce(new Error("whatsapp down"));
    await expect(
      sendInAppNotification("u1", "T", "M", "INFO", undefined, { eventKey: "k" })
    ).resolves.toBeUndefined();
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
  });
});

describe("buildReturnNotification — isi sesuai kondisi", () => {
  it("A. terlambat + rusak: mencantumkan hari, denda, kategori, biaya, dan total", () => {
    const n = buildReturnNotification("Bumi Manusia", {
      daysLate: 3,
      lateFine: 15000,
      conditionLabel: "Halaman sobek",
      damageFine: 10000,
      totalFine: 25000,
    });

    expect(n.title).toBe("Pengembalian Buku — Bumi Manusia");
    expect(n.message).toBe(
      "Buku terlambat dikembalikan selama 3 hari.\n" +
        "Denda keterlambatan: Rp15.000.\n" +
        "Kategori kerusakan: Halaman sobek.\n" +
        "Biaya kerusakan: Rp10.000.\n" +
        "Total biaya: Rp25.000."
    );
    expect(n.type).toBe("WARNING");
  });

  it("B. tepat waktu + rusak: tidak menyebut terlambat, tanpa baris total", () => {
    const n = buildReturnNotification("Bumi Manusia", {
      daysLate: 0,
      lateFine: 0,
      conditionLabel: "Sampul rusak",
      damageFine: 15000,
      totalFine: 15000,
    });

    expect(n.message).toBe(
      "Buku dikembalikan tepat waktu.\n" +
        "Kategori kerusakan: Sampul rusak.\n" +
        "Biaya kerusakan: Rp15.000."
    );
    expect(n.message.toLowerCase()).not.toContain("terlambat");
  });

  it("C. terlambat tanpa rusak: tidak menyebut kerusakan", () => {
    const n = buildReturnNotification("Bumi Manusia", {
      daysLate: 2,
      lateFine: 2000,
      conditionLabel: "Baik (tidak ada kerusakan)",
      damageFine: 0,
      totalFine: 2000,
    });

    expect(n.message).toBe(
      "Buku terlambat dikembalikan selama 2 hari.\nDenda keterlambatan: Rp2.000."
    );
    expect(n.message.toLowerCase()).not.toContain("kerusakan");
  });

  it("D. tepat waktu tanpa rusak: teks pengembalian normal dipertahankan", () => {
    const n = buildReturnNotification("Bumi Manusia", {
      daysLate: 0,
      lateFine: 0,
      conditionLabel: null,
      damageFine: 0,
      totalFine: 0,
    });

    expect(n.title).toBe("Pengembalian Berhasil");
    expect(n.message).toBe('Terima kasih telah mengembalikan buku "Bumi Manusia".');
    expect(n.type).toBe("SUCCESS");
  });
});

describe("buildReturnWhatsAppNotification — khusus buku rusak", () => {
  it("mengembalikan null bila tidak ada kerusakan", () => {
    expect(
      buildReturnWhatsAppNotification("Bumi Manusia", {
        daysLate: 2,
        lateFine: 2000,
        conditionLabel: null,
        damageFine: 0,
        totalFine: 2000,
      })
    ).toBeNull();
  });

  it("A. rusak + terlambat: status, Peringatan!, kerusakan, denda keterlambatan, total, penutup", () => {
    const n = buildReturnWhatsAppNotification("Bumi Manusia", {
      daysLate: 3,
      lateFine: 3000,
      conditionLabel: "Halaman sobek",
      damageFine: 10000,
      totalFine: 13000,
      timeliness: "LATE",
    });

    expect(n).not.toBeNull();
    expect(n!.message).toBe(
      "Buku dikembalikan terlambat.\n\n" +
        "Peringatan!\n\n" +
        "Kategori kerusakan: Halaman sobek.\n" +
        "Biaya kerusakan: Rp10.000.\n" +
        "Denda keterlambatan: Rp3.000.\n" +
        "Total denda: Rp13.000.\n\n" +
        "Dimohon untuk segera membayar denda. Untuk pembayaran diharap hubungi pustakawan terlebih dahulu."
    );
  });

  it("B. rusak + tepat waktu: tanpa baris denda keterlambatan/total", () => {
    const n = buildReturnWhatsAppNotification("Bumi Manusia", {
      daysLate: 0,
      lateFine: 0,
      conditionLabel: "Sampul rusak",
      damageFine: 15000,
      totalFine: 15000,
      timeliness: "ONTIME",
    });

    expect(n!.message).toContain("Buku dikembalikan tepat waktu.");
    expect(n!.message).not.toContain("Denda keterlambatan");
    expect(n!.message).not.toContain("Total denda");
  });

  it("F.9 biaya kerusakan & denda keterlambatan tetap baris terpisah", () => {
    const n = buildReturnWhatsAppNotification("Bumi Manusia", {
      daysLate: 3,
      lateFine: 15000,
      conditionLabel: "Sampul rusak",
      damageFine: 10000,
      totalFine: 25000,
      timeliness: "LATE",
    });

    expect(n!.message).toContain("Biaya kerusakan: Rp10.000.");
    expect(n!.message).toContain("Denda keterlambatan: Rp15.000.");
    expect(n!.message).toContain("Total denda: Rp25.000.");
    expect(n!.message).not.toContain("Biaya kerusakan: Rp15.000.");
  });

  it("UNKNOWN: baris status dihilangkan, tidak menebak", () => {
    const n = buildReturnWhatsAppNotification("Bumi Manusia", {
      daysLate: 0,
      lateFine: 0,
      conditionLabel: "Halaman sobek",
      damageFine: 5000,
      totalFine: 5000,
      timeliness: "UNKNOWN",
    });

    expect(n!.message.startsWith("Peringatan!")).toBe(true);
    expect(n!.message.toLowerCase()).not.toContain("tepat waktu");
    expect(n!.message.toLowerCase()).not.toContain("terlambat");
  });
});

describe("buildFinePaymentNotification — penanda LUNAS", () => {
  it("sisa Rp0 menyertakan LUNAS", () => {
    const n = buildFinePaymentNotification("Bumi Manusia", 15000, 0);
    expect(n.message).toBe(
      'Pembayaran denda Rp15.000 untuk "Bumi Manusia" telah dicatat. Sisa: Rp0.\n\nLUNAS'
    );
  });

  it("pembayaran sebagian tidak menyertakan LUNAS", () => {
    const n = buildFinePaymentNotification("Bumi Manusia", 10000, 5000);
    expect(n.message).not.toContain("LUNAS");
  });
});

describe("notifyReturnSuccess — konsistensi in-app & WhatsApp", () => {
  it("buku rusak: in-app format lama, WhatsApp format khusus", async () => {
    const fines = {
      daysLate: 3,
      lateFine: 3000,
      conditionLabel: "Halaman sobek",
      damageFine: 10000,
      totalFine: 13000,
      timeliness: "LATE" as const,
    };
    await notifyReturnSuccess("s1", "Bumi Manusia", "b1", fines, {
      eventKey: "borrow:return:b1",
    });

    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: {
        userId: "s1",
        title: "Pengembalian Buku — Bumi Manusia",
        message:
          "Buku terlambat dikembalikan selama 3 hari.\n" +
          "Denda keterlambatan: Rp3.000.\n" +
          "Kategori kerusakan: Halaman sobek.\n" +
          "Biaya kerusakan: Rp10.000.\n" +
          "Total biaya: Rp13.000.",
        type: "WARNING",
        link: "/student/borrows",
      },
    });

    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "s1",
        eventKey: "borrow:return:b1",
        category: "RETURN",
        message: expect.stringContaining("Peringatan!"),
      })
    );
  });

  it("tanpa kerusakan: WhatsApp memakai teks in-app yang sama", async () => {
    await notifyReturnSuccess(
      "s1",
      "Bumi Manusia",
      "b1",
      { daysLate: 2, lateFine: 2000, conditionLabel: null, damageFine: 0, totalFine: 2000 },
      { eventKey: "borrow:return:b1" }
    );

    const inApp = mockNotificationCreate.mock.calls[0][0].data;
    const wa = mockDeliver.mock.calls[0][0];
    expect(wa.title).toBe(inApp.title);
    expect(wa.message).toBe(inApp.message);
  });
});

describe("notifyBorrowRejected", () => {
  it("judul & isi sama di kedua kanal", async () => {
    await notifyBorrowRejected("s1", "Laskar Pelangi", "b2", { eventKey: "borrow:reject:b2" });

    const title = "Pengajuan Peminjaman Ditolak";
    const message =
      'Pengajuan peminjaman "Laskar Pelangi" tidak disetujui. Silakan hubungi pustakawan.';

    expect(title).toBe(BORROW_REJECTED_TITLE);
    expect(message).toBe(buildBorrowRejectedMessage("Laskar Pelangi"));
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "s1", title, message, category: "BORROW" })
    );
  });
});

describe("notifyBorrowSuccess", () => {
  it("forwards borrower message and librarians receive in-app + WhatsApp", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "lib-1" }]);

    await notifyBorrowSuccess(
      "student-1",
      "Buku A",
      "b1",
      new Date("2030-01-01T00:00:00.000Z"),
      { eventKey: "borrow:approve:b1" }
    );

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "student-1", title: "Peminjaman Berhasil" }),
      })
    );
    expect(mockNotificationCreateMany).toHaveBeenCalledTimes(1);
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "student-1",
        eventKey: "borrow:approve:b1",
        category: "BORROW",
      })
    );
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "lib-1",
        eventKey: "librarian:borrow:b1:lib-1",
        category: "BORROW",
      })
    );
  });
});

describe("processUpcomingDueNotifications", () => {
  it("forwards with DUE_REMINDER and a stable eventKey", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b1",
        userId: "u1",
        dueDate: new Date("2030-01-01T00:00:00.000Z"),
        book: { title: "Buku A" },
        user: { name: "Siswa" },
      },
    ]);

    const count = await processUpcomingDueNotifications();
    expect(count).toBe(1);
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        eventKey: "borrow:upcoming:b1",
        category: "DUE_REMINDER",
      })
    );
  });
});

describe("processOverdueNotifications", () => {
  it("forwards OVERDUE and keeps librarian broadcast", async () => {
    mockBorrowFindMany.mockResolvedValue([
      {
        id: "b2",
        userId: "u1",
        dueDate: new Date("2000-01-01T00:00:00.000Z"),
        book: { title: "Buku B" },
        user: { name: "Siswa" },
      },
    ]);
    mockBorrowUpdate.mockResolvedValue({});
    mockUserFindMany.mockResolvedValue([{ id: "lib-1" }]);

    const count = await processOverdueNotifications();
    expect(count).toBe(1);
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", eventKey: "borrow:overdue:b2", category: "OVERDUE" })
    );
    expect(mockNotificationCreateMany).toHaveBeenCalledTimes(1);
  });
});

describe("processEbookExpiryNotifications", () => {
  it("notifies only truly expired active loans", async () => {
    mockEbookFindMany.mockResolvedValue([
      { id: "loan1", userId: "u1", book: { title: "Ebook A" } },
    ]);
    mockEbookUpdateMany.mockResolvedValue({ count: 1 });

    const count = await processEbookExpiryNotifications();
    expect(count).toBe(1);
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", eventKey: "ebook:expire:loan1", category: "EBOOK" })
    );
  });

  it("does not notify when the atomic update matched no row", async () => {
    mockEbookFindMany.mockResolvedValue([
      { id: "loan2", userId: "u1", book: { title: "Ebook B" } },
    ]);
    mockEbookUpdateMany.mockResolvedValue({ count: 0 });

    const count = await processEbookExpiryNotifications();
    expect(count).toBe(0);
    expect(mockDeliver).not.toHaveBeenCalled();
  });
});

describe("notifyNewBook", () => {
  it("creates in-app for every active user and forwards BOOK category", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);

    const count = await notifyNewBook({ id: "book-1", title: "Buku Baru", author: "Penulis" });

    expect(count).toBe(2);
    expect(mockNotificationCreateMany).toHaveBeenCalledTimes(1);
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        eventKey: "book:new:book-1:u1",
        category: "BOOK",
      })
    );
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u2",
        eventKey: "book:new:book-1:u2",
        category: "BOOK",
      })
    );
  });
});
