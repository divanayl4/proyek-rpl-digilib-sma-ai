/**
 * Route-level tests for PATCH /api/borrows/[id].
 *
 * Mengunci aturan inti siklus hidup peminjaman:
 *   - hanya pustakawan yang boleh menyetujui/menolak/mengembalikan/membayar denda
 *   - return meng-*snapshot* denda memakai tarif yang berlaku saat itu
 *   - stok baru berkurang saat pengajuan disetujui (status -> BORROWED)
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

const mockGetFinePerDayIDR = jest.fn().mockResolvedValue(1000);
const mockGetDamageFineIDR = jest.fn().mockResolvedValue(5000);

jest.mock("@/lib/config/settings", () => ({
  getFinePerDayIDR: (...args: unknown[]) => mockGetFinePerDayIDR(...args),
  getDamageFineIDR: (...args: unknown[]) => mockGetDamageFineIDR(...args),
  getDamageFineConfig: jest.fn(),
  isFineRateConfigured: jest.fn(),
  setFinePerDayIDR: jest.fn(),
  setDamageFineIDR: jest.fn(),
  SETTING_KEYS: {},
}));

const mockTransaction = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    borrowRecord: { findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

const mockNotifyReturnSuccess = jest.fn().mockResolvedValue(undefined);
const mockNotifyBorrowRejected = jest.fn().mockResolvedValue(undefined);
const mockSendInAppNotification = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/notifications", () => {
  const resolved = () => jest.fn().mockResolvedValue(undefined);
  const actual = jest.requireActual("@/lib/notifications");
  return {
    // Builder murni memakai implementasi asli agar pesan LUNAS ikut teruji.
    buildFinePaymentNotification: actual.buildFinePaymentNotification,
    notifyBorrowSuccess: resolved(),
    notifyReturnSuccess: (...args: unknown[]) => mockNotifyReturnSuccess(...args),
    notifyBorrowRejected: (...args: unknown[]) => mockNotifyBorrowRejected(...args),
    sendInAppNotification: (...args: unknown[]) => mockSendInAppNotification(...args),
    notifyLibrarians: resolved(),
    processOverdueNotifications: resolved(),
    processUpcomingDueNotifications: resolved(),
  };
});

import { prisma } from "@/lib/prisma";
import { calculateLateDays } from "@/lib/config/library";
import { PATCH } from "@/app/api/borrows/[id]/route";

const DAY = 1000 * 60 * 60 * 24;

function makeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/borrows/b1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: { id: "b1" } };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFinePerDayIDR.mockResolvedValue(1000);
});

describe("PATCH /api/borrows/[id] authorization", () => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await PATCH(makeReq({ action: "approve" }), params);
    expect(res.status).toBe(401);
  });

  it("forbids a student from approving a request", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "s1", role: "STUDENT" } });
    const res = await PATCH(makeReq({ action: "approve" }), params);
    expect(res.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("forbids a non-librarian from recording a fine payment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "s1", role: "STUDENT" } });
    const res = await PATCH(makeReq({ action: "pay-fine", amount: 500 }), params);
    expect(res.status).toBe(403);
  });

  it("rejects an unknown action", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const res = await PATCH(makeReq({ action: "explode" }), params);
    expect(res.status).toBe(400);
  });
});

describe("PATCH approve", () => {
  it("moves a REQUESTED borrow to BORROWED when stock is available", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });

    const tx = {
      borrowRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "b1",
          status: "REQUESTED",
          bookId: "bk1",
          book: { stock: 2 },
          user: { role: "STUDENT" },
        }),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "b1",
            userId: "s1",
            status: data.status,
            dueDate: data.dueDate,
            user: { id: "s1", name: "Siswa" },
            book: { id: "bk1", title: "Buku" },
          })
        ),
      },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await PATCH(makeReq({ action: "approve" }), params);
    expect(res.status).toBe(200);
    expect(tx.borrowRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "BORROWED" }) })
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "APPROVE_BORROW" }) })
    );
  });

  it("refuses to approve when stock has run out", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });

    const tx = {
      borrowRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "b1",
          status: "REQUESTED",
          bookId: "bk1",
          book: { stock: 1 },
          user: { role: "STUDENT" },
        }),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await PATCH(makeReq({ action: "approve" }), params);
    expect(res.status).toBe(400);
    expect(tx.borrowRecord.update).not.toHaveBeenCalled();
  });
});

describe("PATCH return", () => {
  it("snapshots the fine using the currently configured rate", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const dueDate = new Date(Date.now() - 3 * DAY);

    const tx = {
      borrowRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "b1",
          status: "BORROWED",
          dueDate,
          bookId: "bk1",
          book: { title: "Buku" },
          user: { id: "s1", role: "STUDENT" },
        }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "b1",
            userId: "s1",
            status: data.status,
            book: { id: "bk1", title: "Buku" },
            user: { id: "s1", name: "Siswa", email: "s@x.id" },
          })
        ),
        count: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await PATCH(makeReq({ action: "return" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    const updateData = tx.borrowRecord.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("RETURNED");
    expect(updateData.fineRate).toBe(1000);
    expect(updateData.finePaid).toBe(false);
    // Denda yang disnapshot harus sama dengan yang dilaporkan respons,
    // dan minimal 3 hari (tenggat ~3 hari lalu).
    expect(updateData.fineAmount).toBe(body.fineAmount);
    expect(calculateLateDays(dueDate, new Date())).toBeGreaterThanOrEqual(3);
  });

  function buildReturnTx(dueDate: Date) {
    const tx = {
      borrowRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "b1",
          status: "BORROWED",
          dueDate,
          bookId: "bk1",
          book: { title: "Buku" },
          user: { id: "s1", role: "STUDENT" },
        }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "b1",
            userId: "s1",
            status: data.status,
            book: { id: "bk1", title: "Buku" },
            user: { id: "s1", name: "Siswa", email: "s@x.id" },
          })
        ),
        count: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
    return tx;
  }

  it("adds a damage fine for a damaged condition and snapshots the breakdown", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    // On-time return so the fine comes purely from the condition.
    const tx = buildReturnTx(new Date(Date.now() + DAY));

    const res = await PATCH(makeReq({ action: "return", condition: "TORN_PAGE" }), params);

    expect(res.status).toBe(200);
    const updateData = tx.borrowRecord.update.mock.calls[0][0].data;
    expect(updateData.lateFineAmount).toBe(0);
    expect(updateData.damageFineAmount).toBe(5000);
    expect(updateData.damageFineRate).toBe(5000);
    expect(updateData.fineAmount).toBe(5000);
    expect(updateData.returnCondition).toBe("TORN_PAGE");
    expect(updateData.finePaid).toBe(false);
    expect(mockGetDamageFineIDR).toHaveBeenCalledWith("TORN_PAGE");
  });

  it("combines late and damage fines into the total", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const tx = buildReturnTx(new Date(Date.now() - 3 * DAY));

    const res = await PATCH(makeReq({ action: "return", condition: "TORN_PAGE" }), params);
    expect(res.status).toBe(200);

    const updateData = tx.borrowRecord.update.mock.calls[0][0].data;
    expect(updateData.damageFineAmount).toBe(5000);
    expect(updateData.lateFineAmount).toBeGreaterThan(0);
    expect(updateData.lateFineAmount % 1000).toBe(0);
    expect(updateData.fineAmount).toBe(updateData.lateFineAmount + 5000);
    expect(updateData.returnCondition).toBe("TORN_PAGE");
  });

  it("applies no damage fine for the GOOD condition", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const tx = buildReturnTx(new Date(Date.now() + DAY));

    const res = await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(res.status).toBe(200);
    const updateData = tx.borrowRecord.update.mock.calls[0][0].data;
    expect(updateData.damageFineAmount).toBe(0);
    expect(updateData.fineAmount).toBe(0);
    expect(updateData.finePaid).toBe(true);
  });

  it("rejects an unknown damage condition", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const tx = buildReturnTx(new Date(Date.now() + DAY));

    const res = await PATCH(makeReq({ action: "return", condition: "MYSTERY" }), params);

    expect(res.status).toBe(400);
    expect(tx.borrowRecord.update).not.toHaveBeenCalled();
    expect(mockGetDamageFineIDR).not.toHaveBeenCalled();
  });
});

describe("PATCH return — notifikasi keterlambatan & kerusakan", () => {
  const FIXED = new Date("2026-10-18T05:00:00.000Z");

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED);
    mockGetFinePerDayIDR.mockResolvedValue(1000);
    // Tarif per kategori (mengikuti tarif yang dikonfigurasi pada data nyata).
    mockGetDamageFineIDR.mockImplementation((key: string) =>
      Promise.resolve(key === "COVER_DAMAGE" ? 15000 : 5000)
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function returnTx(dueDate: Date, bookTitle = "Bumi Manusia") {
    const tx = {
      borrowRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "b1",
          status: "BORROWED",
          dueDate,
          bookId: "bk1",
          book: { title: bookTitle },
          user: { id: "s1", role: "STUDENT" },
        }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "b1",
            userId: "s1",
            status: data.status,
            returnCondition: data.returnCondition,
            book: { id: "bk1", title: bookTitle },
            user: { id: "s1", name: "Siswa", email: "s@x.id" },
          })
        ),
        count: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
    return tx;
  }

  it("A. terlambat + rusak: hari, denda, kategori, biaya, dan total benar", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime() - 3 * DAY));

    const res = await PATCH(makeReq({ action: "return", condition: "COVER_DAMAGE" }), params);
    expect(res.status).toBe(200);

    expect(mockNotifyReturnSuccess).toHaveBeenCalledTimes(1);
    const [userId, title, borrowId, fines] = mockNotifyReturnSuccess.mock.calls[0];
    expect(userId).toBe("s1");
    expect(title).toBe("Bumi Manusia");
    expect(borrowId).toBe("b1");
    expect(fines).toMatchObject({
      daysLate: 3,
      lateFine: 3000,
      conditionLabel: "Sampul rusak",
      damageFine: 15000,
      totalFine: 18000,
    });
    // total = keterlambatan + kerusakan, dijumlahkan SEKALI (tidak dobel).
    const f = fines as { lateFine: number; damageFine: number; totalFine: number };
    expect(f.totalFine).toBe(f.lateFine + f.damageFine);
  });

  it("B. tepat waktu + rusak: 0 hari, 0 denda keterlambatan, hanya biaya kerusakan (regresi 'terlambat 0 hari')", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime() + DAY));

    const res = await PATCH(makeReq({ action: "return", condition: "COVER_DAMAGE" }), params);
    expect(res.status).toBe(200);

    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({
      daysLate: 0,
      lateFine: 0,
      conditionLabel: "Sampul rusak",
      damageFine: 15000,
      totalFine: 15000,
    });
    // Denda tidak lagi dikirim lewat notifikasi "Denda Keterlambatan" terpisah.
    expect(mockSendInAppNotification).not.toHaveBeenCalled();
  });

  it("C. terlambat tanpa rusak: hanya hari & denda keterlambatan", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime() - 2 * DAY));

    await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({
      daysLate: 2,
      lateFine: 2000,
      damageFine: 0,
      totalFine: 2000,
    });
  });

  it("D. tepat waktu tanpa rusak: tanpa denda (alur normal)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime() + DAY));

    await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({
      daysLate: 0,
      lateFine: 0,
      damageFine: 0,
      totalFine: 0,
    });
  });

  it("pengembalian lebih awal + rusak: tepat waktu, hanya biaya kerusakan", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime() + 5 * DAY));

    await PATCH(makeReq({ action: "return", condition: "TORN_PAGE" }), params);
    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({
      daysLate: 0,
      lateFine: 0,
      conditionLabel: "Halaman sobek",
      damageFine: 5000,
      totalFine: 5000,
    });
  });

  it("jatuh tempo sama dengan tanggal pengembalian: 0 hari & 0 denda keterlambatan", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime()));

    await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({
      daysLate: 0,
      lateFine: 0,
      totalFine: 0,
    });
  });

  it("meneruskan status tepat waktu/terlambat dari perbandingan tanggal (bukan status RETURNED)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });

    returnTx(new Date(FIXED.getTime() - 1 * DAY));
    await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({ timeliness: "LATE" });

    mockNotifyReturnSuccess.mockClear();

    returnTx(new Date(FIXED.getTime() + 1)); // tenggat sedikit di masa depan
    await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({ timeliness: "ONTIME" });
  });

  it("tepat pada tenggat: timeliness ONTIME dan denda keterlambatan nol", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime()));

    await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(mockNotifyReturnSuccess.mock.calls[0][3]).toMatchObject({
      daysLate: 0,
      lateFine: 0,
      timeliness: "ONTIME",
    });
  });

  it("kegagalan kanal notifikasi tidak merusak proses pengembalian", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    returnTx(new Date(FIXED.getTime() - 3 * DAY));
    mockNotifyReturnSuccess.mockRejectedValueOnce(new Error("telegram down"));

    const res = await PATCH(makeReq({ action: "return", condition: "GOOD" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fineAmount).toBeGreaterThan(0);
  });
});

describe("PATCH reject — format notifikasi penolakan", () => {
  it("memakai judul buku sebenarnya dan tidak menyisakan format lama", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });

    const tx = {
      borrowRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "b1",
          status: "REQUESTED",
          notes: null,
          book: { title: "Laskar Pelangi" },
          user: { id: "s1", role: "STUDENT" },
        }),
        update: jest.fn().mockResolvedValue({
          id: "b1",
          userId: "s1",
          book: { id: "bk1", title: "Laskar Pelangi" },
          user: { id: "s1", name: "Siswa" },
        }),
        count: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await PATCH(makeReq({ action: "reject", reason: "Stok habis" }), params);
    expect(res.status).toBe(200);

    expect(mockNotifyBorrowRejected).toHaveBeenCalledTimes(1);
    expect(mockNotifyBorrowRejected).toHaveBeenCalledWith("s1", "Laskar Pelangi", "b1", {
      eventKey: "borrow:reject:b1",
    });
    // Tidak ada jalur notifikasi penolakan lain (format lama) yang tertinggal.
    expect(mockSendInAppNotification).not.toHaveBeenCalled();
  });
});

describe("PATCH pay-fine", () => {
  it("refuses to pay before the book is returned", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "BORROWED",
      fineAmount: 0,
      finePayments: [],
      userId: "s1",
      book: { title: "Buku" },
      user: { name: "Siswa" },
      finePaidById: null,
    });

    const res = await PATCH(makeReq({ action: "pay-fine", amount: 500 }), params);
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("records a partial payment and reports the outstanding balance", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "RETURNED",
      fineAmount: 3000,
      finePayments: [],
      userId: "s1",
      book: { title: "Buku" },
      user: { name: "Siswa" },
      finePaidById: null,
    });

    const tx = {
      finePayment: {
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
      borrowRecord: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await PATCH(makeReq({ action: "pay-fine", amount: 1000, method: "CASH" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalPaid).toBe(1000);
    expect(body.outstanding).toBe(2000);
    expect(body.finePaid).toBe(false);
    expect(tx.finePayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 1000, method: "CASH" }) })
    );
  });

  it("menolak pembayaran yang melebihi sisa setelah total di DB berubah (race)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "RETURNED",
      fineAmount: 3000,
      finePayments: [],
      userId: "s1",
      book: { title: "Buku" },
      user: { name: "Siswa" },
      finePaidById: null,
    });
    // Saldo awal yang dibaca request ini Rp3.000, tetapi request lain sudah
    // mencatat Rp2.500 sebelum transaksi ini berjalan.
    const tx = finePaymentTx(2500);

    const res = await PATCH(makeReq({ action: "pay-fine", amount: 1000 }), params);

    expect(res.status).toBe(400);
    expect(tx.finePayment.create).not.toHaveBeenCalled();
    expect(mockSendInAppNotification).not.toHaveBeenCalled();
  });

  it("pembayaran tanpa amount melunasi sisa yang dihitung di dalam transaksi", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "RETURNED",
      fineAmount: 3000,
      finePayments: [],
      userId: "s1",
      book: { title: "Buku" },
      user: { name: "Siswa" },
      finePaidById: null,
    });
    const tx = finePaymentTx(0);

    const res = await PATCH(makeReq({ action: "pay-fine" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outstanding).toBe(0);
    expect(body.finePaid).toBe(true);
    expect(tx.finePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 3000 }),
    });
  });

  it("rejects a payment larger than the outstanding balance", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "RETURNED",
      fineAmount: 3000,
      finePayments: [{ amount: 2500 }],
      userId: "s1",
      book: { title: "Buku" },
      user: { name: "Siswa" },
      finePaidById: null,
    });

    const res = await PATCH(makeReq({ action: "pay-fine", amount: 1000 }), params);
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  function finePaymentTx(alreadyPaid = 0) {
    const tx = {
      finePayment: {
        create: jest.fn(),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: alreadyPaid || null } }),
      },
      borrowRecord: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn() },
    };
    mockTransaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
    return tx;
  }

  it("D.1 sisa menjadi Rp0: notifikasi menyertakan Sisa: Rp0. dan LUNAS", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "RETURNED",
      fineAmount: 3000,
      finePayments: [{ amount: 2000 }],
      userId: "s1",
      book: { title: "Bumi Manusia" },
      user: { name: "Siswa" },
      finePaidById: null,
    });
    finePaymentTx(2000);

    const res = await PATCH(makeReq({ action: "pay-fine", amount: 1000 }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outstanding).toBe(0);
    expect(body.finePaid).toBe(true);

    expect(mockSendInAppNotification).toHaveBeenCalledTimes(1);
    const [, title, message] = mockSendInAppNotification.mock.calls[0];
    expect(title).toBe("Pembayaran Denda Dicatat");
    expect(message).toContain("Sisa: Rp0.");
    expect(message).toContain("LUNAS");
  });

  it("D.2 pembayaran sebagian: notifikasi TIDAK menyertakan LUNAS", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "RETURNED",
      fineAmount: 3000,
      finePayments: [],
      userId: "s1",
      book: { title: "Bumi Manusia" },
      user: { name: "Siswa" },
      finePaidById: null,
    });
    finePaymentTx();

    const res = await PATCH(makeReq({ action: "pay-fine", amount: 1000 }), params);
    expect(res.status).toBe(200);

    const [, , message] = mockSendInAppNotification.mock.calls[0];
    expect(message).toContain("Sisa: Rp2.000.");
    expect(message).not.toContain("LUNAS");
  });

  it("D.5 pembayaran gagal: tidak ada notifikasi sukses palsu", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    (prisma.borrowRecord.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      status: "RETURNED",
      fineAmount: 3000,
      finePayments: [],
      userId: "s1",
      book: { title: "Buku" },
      user: { name: "Siswa" },
      finePaidById: null,
    });
    mockTransaction.mockRejectedValueOnce(new Error("db down"));

    const res = await PATCH(makeReq({ action: "pay-fine", amount: 1000 }), params);
    expect(res.status).toBe(400);
    expect(mockSendInAppNotification).not.toHaveBeenCalled();
  });
});
