/**
 * Tests that the in-app notification layer forwards the SAME text to Telegram
 * (via the mocked telegram module) with a deterministic eventKey, and that the
 * new ebook-expiry trigger behaves correctly.
 *
 * Notifikasi in-app harus tetap dibuat persis seperti sebelumnya.
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

jest.mock("@/lib/telegram", () => ({
  deliverTelegramNotification: (...args: unknown[]) => mockDeliver(...args),
}));

import {
  sendInAppNotification,
  notifyBorrowSuccess,
  buildReturnNotification,
  buildReturnTelegramNotification,
  buildFinePaymentNotification,
  notifyReturnSuccess,
  notifyBorrowRejected,
  BORROW_REJECTED_TITLE,
  buildBorrowRejectedMessage,
  processUpcomingDueNotifications,
  processOverdueNotifications,
  processEbookExpiryNotifications,
} from "@/lib/notifications";

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificationCreate.mockResolvedValue({});
  mockNotificationCreateMany.mockResolvedValue({ count: 0 });
  mockUserFindMany.mockResolvedValue([]);
  mockDeliver.mockResolvedValue({ sent: true });
});

describe("sendInAppNotification – Telegram forwarding", () => {
  it("creates the in-app row and forwards identical text when eventKey is given", async () => {
    await sendInAppNotification(
      "u1",
      "Peminjaman Berhasil",
      'Buku "Buku A" berhasil dipinjam.',
      "SUCCESS",
      "/student/borrows",
      { eventKey: "borrow:approve:b1" }
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
    });
  });

  it("does not forward to Telegram without an eventKey", async () => {
    await sendInAppNotification("u1", "T", "M");
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it("still creates the in-app row even if Telegram delivery fails", async () => {
    mockDeliver.mockRejectedValueOnce(new Error("telegram down"));
    // deliverTelegramNotification sudah menelan error, tetapi lapisan ini juga
    // membungkusnya agar kegagalan Telegram tidak pernah merambat ke pemanggil.
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
    expect(n.message).not.toContain("Total biaya");
  });

  it("C. terlambat tanpa rusak: tidak menyebut kerusakan/biaya kerusakan", () => {
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

describe("buildReturnTelegramNotification — struktur Bagian B (khusus buku rusak)", () => {
  it("mengembalikan null bila tidak ada kerusakan (Telegram pakai teks in-app)", () => {
    expect(
      buildReturnTelegramNotification("Bumi Manusia", {
        daysLate: 2,
        lateFine: 2000,
        conditionLabel: null,
        damageFine: 0,
        totalFine: 2000,
      })
    ).toBeNull();
    expect(
      buildReturnTelegramNotification("Bumi Manusia", {
        daysLate: 0,
        lateFine: 0,
        conditionLabel: null,
        damageFine: 0,
        totalFine: 0,
      })
    ).toBeNull();
  });

  it("A. rusak + terlambat: status, Peringatan!, kerusakan, denda keterlambatan, total, penutup", () => {
    const n = buildReturnTelegramNotification("Bumi Manusia", {
      daysLate: 3,
      lateFine: 3000,
      conditionLabel: "Halaman sobek",
      damageFine: 10000,
      totalFine: 13000,
      timeliness: "LATE",
    });

    expect(n).not.toBeNull();
    expect(n!.title).toBe("Pengembalian Buku — Bumi Manusia");
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

  it("B. rusak + tepat waktu: menyebut tepat waktu, TANPA baris denda keterlambatan/total", () => {
    const n = buildReturnTelegramNotification("Bumi Manusia", {
      daysLate: 0,
      lateFine: 0,
      conditionLabel: "Sampul rusak",
      damageFine: 15000,
      totalFine: 15000,
      timeliness: "ONTIME",
    });

    expect(n!.message).toBe(
      "Buku dikembalikan tepat waktu.\n\n" +
        "Peringatan!\n\n" +
        "Kategori kerusakan: Sampul rusak.\n" +
        "Biaya kerusakan: Rp15.000.\n\n" +
        "Dimohon untuk segera membayar denda. Untuk pembayaran diharap hubungi pustakawan terlebih dahulu."
    );
    expect(n!.message.toLowerCase()).not.toContain("terlambat");
    expect(n!.message).not.toContain("Denda keterlambatan");
    expect(n!.message).not.toContain("Total denda");
  });

  it("F.9 biaya kerusakan & denda keterlambatan tidak tertukar dan tetap baris terpisah", () => {
    const n = buildReturnTelegramNotification("Bumi Manusia", {
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
    // Tidak tertukar.
    expect(n!.message).not.toContain("Biaya kerusakan: Rp15.000.");
    // Tidak digabung menjadi satu baris.
    expect(n!.message).not.toContain("Biaya kerusakan: Rp10.000. Denda keterlambatan");
  });

  it("tanggal tidak diketahui (UNKNOWN): baris status dihilangkan, tidak menebak", () => {
    const n = buildReturnTelegramNotification("Bumi Manusia", {
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

  it("fallback: tanpa timeliness eksplisit, status diturunkan dari daysLate", () => {
    const onTime = buildReturnTelegramNotification("Buku", {
      daysLate: 0,
      lateFine: 0,
      conditionLabel: "Halaman sobek",
      damageFine: 5000,
      totalFine: 5000,
    });
    expect(onTime!.message.startsWith("Buku dikembalikan tepat waktu.")).toBe(true);

    const late = buildReturnTelegramNotification("Buku", {
      daysLate: 1,
      lateFine: 1000,
      conditionLabel: "Halaman sobek",
      damageFine: 5000,
      totalFine: 6000,
    });
    expect(late!.message.startsWith("Buku dikembalikan terlambat.")).toBe(true);
  });
});

describe("buildFinePaymentNotification — penanda LUNAS", () => {
  it("D.1 sisa menjadi Rp0: menyertakan LUNAS dan nominal aktual", () => {
    const n = buildFinePaymentNotification("Bumi Manusia", 15000, 0);
    expect(n.title).toBe("Pembayaran Denda Dicatat");
    expect(n.message).toBe(
      'Pembayaran denda Rp15.000 untuk "Bumi Manusia" telah dicatat. Sisa: Rp0.\n\nLUNAS'
    );
    expect(n.type).toBe("SUCCESS");
  });

  it("D.2 pembayaran sebagian: TIDAK menyertakan LUNAS", () => {
    const n = buildFinePaymentNotification("Bumi Manusia", 10000, 5000);
    expect(n.message).toBe(
      'Pembayaran denda Rp10.000 untuk "Bumi Manusia" telah dicatat. Sisa: Rp5.000.'
    );
    expect(n.message).not.toContain("LUNAS");
  });

  it("D.3 sisa masih lebih dari Rp0: TIDAK menyertakan LUNAS", () => {
    const n = buildFinePaymentNotification("Buku", 1000, 1);
    expect(n.message).toContain("Sisa: Rp1.");
    expect(n.message).not.toContain("LUNAS");
  });

  it("D.4 nominal pembayaran dan sisa memakai hasil perhitungan aktual", () => {
    const n = buildFinePaymentNotification("Buku", 2500, 2500);
    expect(n.message).toContain("Pembayaran denda Rp2.500");
    expect(n.message).toContain("Sisa: Rp2.500.");
    expect(n.message).not.toContain("LUNAS");
  });
});

describe("notifyReturnSuccess — konsistensi in-app & Telegram", () => {
  it("buku RUSAK: in-app tetap format lama, Telegram memakai format Bagian B (berbeda)", async () => {
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

    // In-app: TIDAK berubah (format lama).
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

    // Telegram: format Bagian B (status + Peringatan! + kerusakan + penutup),
    // dengan denda keterlambatan & total sebagai baris TERPISAH.
    expect(mockDeliver).toHaveBeenCalledWith({
      userId: "s1",
      title: "Pengembalian Buku — Bumi Manusia",
      message:
        "Buku dikembalikan terlambat.\n\n" +
        "Peringatan!\n\n" +
        "Kategori kerusakan: Halaman sobek.\n" +
        "Biaya kerusakan: Rp10.000.\n" +
        "Denda keterlambatan: Rp3.000.\n" +
        "Total denda: Rp13.000.\n\n" +
        "Dimohon untuk segera membayar denda. Untuk pembayaran diharap hubungi pustakawan terlebih dahulu.",
      eventKey: "borrow:return:b1",
    });
  });

  it("tanpa kerusakan: Telegram tetap memakai teks in-app yang sama", async () => {
    await notifyReturnSuccess(
      "s1",
      "Bumi Manusia",
      "b1",
      { daysLate: 2, lateFine: 2000, conditionLabel: null, damageFine: 0, totalFine: 2000 },
      { eventKey: "borrow:return:b1" }
    );

    const inApp = mockNotificationCreate.mock.calls[0][0].data;
    const tg = mockDeliver.mock.calls[0][0];
    expect(tg.title).toBe(inApp.title);
    expect(tg.message).toBe(inApp.message);
  });

  it("kegagalan Telegram tidak merusak: in-app tetap dibuat dan tidak melempar", async () => {
    mockDeliver.mockRejectedValueOnce(new Error("telegram down"));

    await expect(
      notifyReturnSuccess(
        "s1",
        "Bumi Manusia",
        "b1",
        { daysLate: 1, lateFine: 1000, conditionLabel: null, damageFine: 0, totalFine: 1000 },
        { eventKey: "borrow:return:b1" }
      )
    ).resolves.toBeUndefined();

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
  });
});

describe("notifyBorrowRejected — format tetap penolakan", () => {
  it("judul & isi sama di kedua kanal dengan judul buku sebenarnya", async () => {
    await notifyBorrowRejected("s1", "Laskar Pelangi", "b2", { eventKey: "borrow:reject:b2" });

    const title = "Pengajuan Peminjaman Ditolak";
    const message =
      'Pengajuan peminjaman "Laskar Pelangi" tidak disetujui. Silakan hubungi pustakawan.';

    expect(title).toBe(BORROW_REJECTED_TITLE);
    expect(message).toBe(buildBorrowRejectedMessage("Laskar Pelangi"));

    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: { userId: "s1", title, message, type: "WARNING", link: "/student/borrows" },
    });
    expect(mockDeliver).toHaveBeenCalledWith({ userId: "s1", title, message, eventKey: "borrow:reject:b2" });
  });
});

describe("notifyBorrowSuccess", () => {
  it("forwards the borrower message to Telegram and keeps the librarian in-app broadcast", async () => {
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

    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "student-1", eventKey: "borrow:approve:b1" })
    );

    // Pustakawan/Admin tetap menerima notifikasi in-app (tanpa Telegram).
    expect(mockNotificationCreateMany).toHaveBeenCalledTimes(1);
  });
});

describe("processUpcomingDueNotifications", () => {
  it("forwards to Telegram with a stable per-borrow eventKey", async () => {
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
      expect.objectContaining({ userId: "u1", eventKey: "borrow:upcoming:b1" })
    );
  });
});

describe("processOverdueNotifications", () => {
  it("forwards to Telegram with a stable per-borrow eventKey and keeps librarian in-app broadcast", async () => {
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
      expect.objectContaining({ userId: "u1", eventKey: "borrow:overdue:b2" })
    );
    expect(mockNotificationCreateMany).toHaveBeenCalledTimes(1);
  });
});

describe("processEbookExpiryNotifications", () => {
  it("does nothing when there are no expired loans", async () => {
    mockEbookFindMany.mockResolvedValue([]);
    const count = await processEbookExpiryNotifications();
    expect(count).toBe(0);
    expect(mockEbookUpdateMany).not.toHaveBeenCalled();
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it("notifies only truly expired active loans using the built-in text", async () => {
    mockEbookFindMany.mockResolvedValue([
      { id: "loan1", userId: "u1", book: { title: "Ebook A" } },
    ]);
    mockEbookUpdateMany.mockResolvedValue({ count: 1 });

    const count = await processEbookExpiryNotifications();
    expect(count).toBe(1);

    expect(mockEbookUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "loan1", status: "ACTIVE", returnedAt: null }),
        data: { status: "EXPIRED" },
      })
    );

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          title: "Masa Akses Ebook Habis",
          message:
            'Akses baca ebook "Ebook A" telah kedaluwarsa. Kembalikan agar dapat meminjam kembali.',
        }),
      })
    );

    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", eventKey: "ebook:expire:loan1" })
    );
  });

  it("does not notify when the atomic status update matched no row (concurrent)", async () => {
    mockEbookFindMany.mockResolvedValue([
      { id: "loan2", userId: "u1", book: { title: "Ebook B" } },
    ]);
    mockEbookUpdateMany.mockResolvedValue({ count: 0 });

    const count = await processEbookExpiryNotifications();
    expect(count).toBe(0);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
    expect(mockDeliver).not.toHaveBeenCalled();
  });
});
