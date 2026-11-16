const mockSession = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  groupBy: jest.fn(),
};

jest.mock("@/lib/prisma", () => ({
  prisma: { ebookReadingSession: mockSession },
}));

import {
  allowReadingActivityRequest,
  listReadingActivity,
  recordEbookReadingActivity,
  resetReadingActivityThrottle,
} from "@/lib/ebook-reading";

const NOW = new Date("2026-10-22T04:00:00.000Z");

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    bookId: "book-1",
    loanId: "loan-1",
    openKey: "user-1:book-1",
    firstOpenedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    lastActivityAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    endedAt: null,
    lastPage: null,
    progressPercent: null,
    activityCount: 1,
    createdAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    updatedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    ...overrides,
  };
}

function relatedRow(overrides: Record<string, unknown> = {}) {
  return {
    ...sessionRow(overrides),
    user: {
      id: "user-1",
      name: "Siswa Satu",
      role: "STUDENT",
      class: "XII IPA 1",
      identityNumber: "12345",
    },
    book: {
      id: "book-1",
      title: "Matematika Terapan",
      author: "Tim Guru",
      pageCount: 100,
    },
    loan: {
      id: "loan-1",
      borrowedAt: new Date(NOW.getTime() - 86400000),
      expiresAt: new Date(NOW.getTime() + 86400000),
      returnedAt: null,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks tidak menghapus implementasi mockResolvedValue; reset agar
  // hasil findFirst dari kasus sebelumnya tidak bocor.
  mockSession.findFirst.mockReset();
  resetReadingActivityThrottle();
  jest.useRealTimers();
});

describe("recordEbookReadingActivity", () => {
  it("membuat sesi baru dengan identitas/loan dari server dan openKey unik", async () => {
    mockSession.findUnique.mockResolvedValue(null);
    mockSession.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "new-session",
        ...data,
        firstOpenedAt: NOW,
        lastActivityAt: NOW,
        endedAt: null,
        lastPage: null,
        progressPercent: null,
        activityCount: 1,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    const result = await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "open",
      loanId: "loan-1",
      now: NOW,
    });

    expect(mockSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        bookId: "book-1",
        loanId: "loan-1",
        openKey: "user-1:book-1",
        activityCount: 1,
      }),
    });
    expect(result.created).toBe(true);
    expect(result.status).toBe("OPENED");
  });

  it("heartbeat memperbarui sesi yang sama, tidak membuat duplikat", async () => {
    mockSession.findUnique.mockResolvedValue(sessionRow());
    mockSession.update.mockResolvedValue(
      sessionRow({
        lastActivityAt: NOW,
        activityCount: 2,
      })
    );

    const result = await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "heartbeat",
      loanId: "loan-1",
      now: NOW,
    });

    expect(mockSession.create).not.toHaveBeenCalled();
    expect(mockSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        lastActivityAt: NOW,
        activityCount: { increment: 1 },
      }),
    });
    expect(result.created).toBe(false);
    expect(result.status).toBe("ACTIVE");
  });

  it("menutup sesi lama yang idle lalu membuat sesi baru (bukan memperpanjang)", async () => {
    const old = sessionRow({
      lastActivityAt: new Date(NOW.getTime() - 31 * 60 * 1000),
      activityCount: 4,
    });
    mockSession.findUnique.mockResolvedValue(old);
    mockSession.update.mockResolvedValue({ ...old, endedAt: old.lastActivityAt, openKey: null });
    mockSession.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "new-session",
        ...data,
        endedAt: null,
        lastPage: null,
        progressPercent: null,
        activityCount: 1,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    const result = await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "open",
      loanId: "loan-1",
      now: NOW,
    });

    expect(mockSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { endedAt: old.lastActivityAt, openKey: null },
    });
    expect(mockSession.create).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(true);
  });

  it("melanjutkan sesi yang baru ditutup oleh pagehide saat halaman di-refresh", async () => {
    // `close` (pagehide) sudah mengosongkan openKey, jadi findUnique tidak
    // menemukan sesi. `open` harus menemukan sesi yang baru ditutup dan
    // melanjutkannya, bukan membuat sesi baru.
    mockSession.findUnique.mockResolvedValue(null);
    const closed = sessionRow({
      endedAt: new Date(NOW.getTime() - 1000),
      openKey: null,
    });
    mockSession.findFirst.mockResolvedValue(closed);
    mockSession.update.mockResolvedValue({
      ...closed,
      endedAt: null,
      openKey: "user-1:book-1",
      lastActivityAt: NOW,
      activityCount: 2,
    });

    const result = await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "open",
      loanId: "loan-1",
      now: NOW,
    });

    expect(mockSession.create).not.toHaveBeenCalled();
    expect(mockSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        endedAt: null,
        openKey: "user-1:book-1",
        lastActivityAt: NOW,
      }),
    });
    expect(result.created).toBe(false);
    expect(result.sessionId).toBe("session-1");
  });

  it("heartbeat dari tab lain melanjutkan sesi yang baru ditutup", async () => {
    // Dua tab: tab A ditutup (close), tab B masih terbuka dan mengirim heartbeat
    // dalam jendela toleransi. Sesi harus dilanjutkan, bukan dipecah menjadi dua.
    mockSession.findUnique.mockResolvedValue(null);
    const closed = sessionRow({
      endedAt: new Date(NOW.getTime() - 5000),
      openKey: null,
    });
    mockSession.findFirst.mockResolvedValue(closed);
    mockSession.update.mockResolvedValue({
      ...closed,
      endedAt: null,
      openKey: "user-1:book-1",
      lastActivityAt: NOW,
      activityCount: 2,
    });

    const result = await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "heartbeat",
      loanId: "loan-1",
      now: NOW,
    });

    expect(mockSession.create).not.toHaveBeenCalled();
    expect(result.sessionId).toBe("session-1");
    expect(result.created).toBe(false);
  });

  it("open bersamaan saat resume memakai sesi yang menang, tanpa 500/duplikat", async () => {
    mockSession.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sessionRow({ activityCount: 2 }));
    mockSession.findFirst.mockResolvedValue(
      sessionRow({ endedAt: new Date(NOW.getTime() - 5000), openKey: null })
    );
    mockSession.update
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce(sessionRow({ activityCount: 3, lastActivityAt: NOW }));

    const result = await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "open",
      loanId: "loan-1",
      now: NOW,
    });

    expect(mockSession.create).not.toHaveBeenCalled();
    expect(result.sessionId).toBe("session-1");
  });

  it("tidak menimpa progres yang lebih jauh dengan halaman lebih rendah", async () => {
    mockSession.findUnique.mockResolvedValue(
      sessionRow({ lastPage: 3, progressPercent: 60, activityCount: 2 })
    );
    mockSession.update.mockResolvedValue(
      sessionRow({ lastPage: 3, progressPercent: 60, activityCount: 3, lastActivityAt: NOW })
    );

    await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "heartbeat",
      loanId: "loan-1",
      page: 1,
      progressPercent: 10,
      now: NOW,
    });

    const updateCall = mockSession.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("lastPage");
    expect(updateCall.data).not.toHaveProperty("progressPercent");
  });

  it("close menutup sesi milik pengguna dan mengosongkan openKey", async () => {
    mockSession.findUnique.mockResolvedValue(sessionRow());
    mockSession.update.mockResolvedValue(
      sessionRow({ endedAt: NOW, openKey: null })
    );

    const result = await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "close",
      now: NOW,
    });

    expect(mockSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { endedAt: NOW, openKey: null },
    });
    expect(result.closed).toBe(true);
    expect(result.status).toBe("INACTIVE");
  });

  it("page/progres hanya disimpan bila valid dari route", async () => {
    mockSession.findUnique.mockResolvedValue(null);
    mockSession.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "new-session",
        ...data,
        endedAt: null,
        activityCount: 1,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    await recordEbookReadingActivity({
      userId: "user-1",
      bookId: "book-1",
      event: "heartbeat",
      loanId: "loan-1",
      page: 50,
      progressPercent: 50,
      now: NOW,
    });

    expect(mockSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lastPage: 50, progressPercent: 50 }),
    });
  });
});

describe("listReadingActivity", () => {
  it("menerapkan pagination, total, dan summary unik secara terpisah", async () => {
    mockSession.findMany.mockResolvedValue([
      relatedRow({ activityCount: 2 }),
      relatedRow({
        id: "session-2",
        userId: "user-2",
        activityCount: 1,
        lastActivityAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      }),
    ]);
    mockSession.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mockSession.groupBy
      .mockResolvedValueOnce([{ userId: "user-1" }, { userId: "user-2" }])
      .mockResolvedValueOnce([{ bookId: "book-1" }, { bookId: "book-2" }]);

    const result = await listReadingActivity({
      filters: { search: "Siswa" },
      page: 2,
      pageSize: 2,
      now: NOW,
    });

    expect(mockSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 2, take: 2 })
    );
    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(result.summary).toEqual({
      totalSessions: 5,
      uniqueUsers: 2,
      uniqueBooks: 2,
      activeSessions: 2,
      openedSessions: 1,
      inactiveSessions: 2,
    });
    expect(result.pageTrackingSupported).toBe(true);
    expect(result.rows[0].status).toBe("ACTIVE");
  });

  it("menurunkan status pinjaman terkait dari timestamp, bukan kolom status", async () => {
    const expiredLoanRow = relatedRow();
    expiredLoanRow.loan = {
      id: "loan-old",
      borrowedAt: new Date(NOW.getTime() - 10 * 86400000),
      expiresAt: new Date(NOW.getTime() - 86400000),
      returnedAt: null,
    };
    mockSession.findMany.mockResolvedValue([expiredLoanRow]);
    mockSession.count.mockResolvedValue(1);
    mockSession.groupBy.mockResolvedValue([]);

    const result = await listReadingActivity({ now: NOW, pageSize: 10 });

    expect(result.rows[0].loan?.accessState).toBe("EXPIRED");
  });
});

describe("throttle aktivitas", () => {
  it("membatasi request berlebihan per pengguna+buku", () => {
    for (let i = 0; i < 30; i += 1) {
      expect(allowReadingActivityRequest("user-1", "book-1", NOW)).toBe(true);
    }
    expect(allowReadingActivityRequest("user-1", "book-1", NOW)).toBe(false);
    expect(allowReadingActivityRequest("user-2", "book-1", NOW)).toBe(true);
  });

  it("jendela throttle kembali terbuka setelah 60 detik", () => {
    for (let i = 0; i < 30; i += 1) {
      allowReadingActivityRequest("user-1", "book-1", NOW);
    }
    const later = new Date(NOW.getTime() + 61 * 1000);
    expect(allowReadingActivityRequest("user-1", "book-1", later)).toBe(true);
  });
});
