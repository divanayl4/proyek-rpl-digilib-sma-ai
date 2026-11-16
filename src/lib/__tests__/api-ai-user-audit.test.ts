/**
 * AI Chat — Riwayat AUDIT pembuatan & penghapusan akun (khusus ADMIN).
 *
 * Fokus keamanan (PERSYARATAN UTAMA):
 *  - Hanya role ADMIN yang boleh menerima hasil query AuditLog.
 *  - Otorisasi diperiksa di SERVER (role dari akun yang dimuat server), bukan
 *    dari body request/klaim pengguna.
 *  - Non-admin (LIBRARIAN, TEACHER, STUDENT, STAFF) tidak pernah dapat membaca
 *    audit — baik lewat pipeline, route, maupun pemanggilan tool langsung.
 *  - Role palsu yang dikirim di body TIDAK memberi akses.
 *  - Kegagalan query tidak disamarkan sebagai hasil kosong.
 *  - Audit tidak bocor lewat riwayat percakapan atau pesan penolakan.
 *  - Pelaku aksi dibedakan dari akun target, dan waktu pembuatan akun dibedakan
 *    dari waktu pencatatan audit (zona Asia/Jakarta / WIB).
 *
 * Semua data bersumber dari mock terisolasi — tidak ada data pengguna asli yang
 * diubah maupun dibaca.
 */

const mockGetServerSession = jest.fn();
const mockFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserCount = jest.fn();
const mockAuditFindMany = jest.fn();
const mockAuditCount = jest.fn();
const mockSettingFindMany = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockBorrowCount = jest.fn();
const mockEbookFindMany = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);
const mockBuildPersonalAnswer = jest.fn();
const mockBuildCatalogAnswer = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockFindUnique, findMany: mockUserFindMany, count: mockUserCount },
    auditLog: { findMany: mockAuditFindMany, count: mockAuditCount },
    setting: { findMany: mockSettingFindMany },
    borrowRecord: { findMany: mockBorrowFindMany, count: mockBorrowCount },
    ebookLoan: { findMany: mockEbookFindMany },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat, chatWithTools: mockChatWithTools }),
  isAIConfigured: () => mockIsConfigured(),
}));

jest.mock("@/lib/ai/personal", () => {
  const actual = jest.requireActual("@/lib/ai/personal");
  return { ...actual, buildPersonalAnswer: (...args: unknown[]) => mockBuildPersonalAnswer(...args) };
});

jest.mock("@/lib/ai/catalog", () => {
  const actual = jest.requireActual("@/lib/ai/catalog");
  return { ...actual, buildCatalogAnswer: (...args: unknown[]) => mockBuildCatalogAnswer(...args) };
});

import { processChat, resetRateLimits } from "@/lib/ai/pipeline";
import { executeTool, toolsForRole } from "@/lib/ai/tools";
import { AUDIT_ADMIN_ONLY, USER_AUDIT_UNAVAILABLE } from "@/lib/ai/personalAnswer";
import { POST } from "@/app/api/ai/chat/route";

const USER_ID = "user-1";

function account(role: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "Pengguna Uji",
    role,
    gender: null,
    class: null,
    isActive: true,
    ...overrides,
  };
}

function input(content: string) {
  return { userId: USER_ID, messages: [{ role: "user", content }] };
}

function historyInput(history: Array<{ role: string; content: string }>, content: string) {
  return {
    userId: USER_ID,
    messages: [...history, { role: "user", content }],
  };
}

function post(body: unknown) {
  return new Request("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

/** Baris AuditLog seperti hasil prisma.auditLog.findMany (include user). */
function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    action: "DELETE_USER",
    userId: "admin-1",
    details: "Menghapus pengguna: najla@sma.id (STUDENT)",
    createdAt: new Date("2026-10-18T08:20:00.000Z"), // 15:20 WIB
    user: { name: "Admin Utama", role: "ADMIN" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(account("ADMIN", { name: "Admin Utama" }));
  mockAuditFindMany.mockResolvedValue([]);
  mockAuditCount.mockResolvedValue(0);
  mockUserFindMany.mockResolvedValue([]);
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

// ---------------------------------------------------------------------------
// 1. ADMIN dapat membaca riwayat (dari AuditLog aktual)
// ---------------------------------------------------------------------------

describe("ADMIN — membaca riwayat audit dari AuditLog", () => {
  it("menampilkan akun yang dihapus pada tanggal tertentu dari AuditLog", async () => {
    mockAuditFindMany.mockResolvedValue([auditRow()]);
    mockAuditCount.mockResolvedValue(1);
    mockUserFindMany.mockResolvedValue([
      {
        email: "najla@sma.id",
        name: "Najla",
        role: "STUDENT",
        createdAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    ]);

    const res = await processChat(input("Siapa saja pengguna yang dihapus pada 18 Oktober 2026?"));

    expect(res.intent).toBe("USER_AUDIT");
    expect(res.message).toContain("Najla");
    expect(res.message).toContain("Siswa"); // role target
    expect(res.message).toContain("dihapus");
    expect(res.message).toContain("Admin Utama");
    expect(res.message).toContain("15:20 WIB");
    // Email pengguna lain tidak pernah ditampilkan.
    expect(res.message).not.toContain("najla@sma.id");

    // Query difilter ke aksi DELETE_USER dan rentang hari Jakarta yang benar.
    expect(mockAuditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: { in: ["USER_DELETED"] },
          createdAt: {
            gte: new Date("2026-10-17T17:00:00.000Z"),
            lt: new Date("2026-10-18T17:00:00.000Z"),
          },
        }),
      })
    );
    // Jalur model TIDAK dipakai untuk audit.
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("membedakan pelaku aksi dari akun target", async () => {
    mockAuditFindMany.mockResolvedValue([
      auditRow({
        action: "CREATE_USER",
        details: "Membuat pengguna baru: budi@sma.id (STUDENT)",
        createdAt: new Date("2026-10-18T02:05:00.000Z"),
        user: { name: "Admin Utama", role: "ADMIN" },
      }),
    ]);
    mockAuditCount.mockResolvedValue(1);
    mockUserFindMany.mockResolvedValue([
      {
        email: "budi@sma.id",
        name: "Budi",
        role: "STUDENT",
        createdAt: new Date("2026-10-18T02:05:00.000Z"),
      },
    ]);

    const res = await processChat(input("Akun apa saja yang dibuat pada 18 Oktober 2026?"));

    // Pelaku dan target adalah dua entitas berbeda pada satu baris.
    expect(res.message).toContain("Budi"); // target
    expect(res.message).not.toContain("budi@sma.id");
    expect(res.message).toContain("Admin Utama"); // pelaku
    expect(mockAuditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: { in: ["CREATE_USER", "REGISTER_STUDENT"] },
        }),
      })
    );
  });

  it("membedakan waktu PEMBUATAN AKUN dari waktu PENCATATAN AUDIT (WIB)", async () => {
    mockAuditFindMany.mockResolvedValue([
      auditRow({
        action: "CREATE_USER",
        details: "Membuat pengguna baru: budi@sma.id (STUDENT)",
        createdAt: new Date("2026-10-18T02:05:00.000Z"), // audit: 09:05 WIB
      }),
    ]);
    mockAuditCount.mockResolvedValue(1);
    mockUserFindMany.mockResolvedValue([
      {
        email: "budi@sma.id",
        name: "Budi",
        role: "STUDENT",
        createdAt: new Date("2026-10-18T01:00:00.000Z"),
      }, // akun: 08:00 WIB
    ]);

    const res = await processChat(input("Akun apa saja yang dibuat pada 18 Oktober 2026?"));

    expect(res.message).toContain("audit dicatat 2026-10-18 09:05 WIB");
    expect(res.message).toContain("Waktu akun dibuat: 2026-10-18 08:00 WIB");
  });

  it("memfilter nama/email target agar tidak menampilkan seluruh riwayat", async () => {
    mockAuditFindMany.mockResolvedValue([auditRow()]);
    mockAuditCount.mockResolvedValue(1);

    await processChat(input("Kapan akun Najla dibuat?"));

    expect(mockAuditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { details: { contains: "najla" } },
            { user: { name: { contains: "najla" } } },
            { user: { email: { contains: "najla" } } },
          ]),
        }),
      })
    );
  });

  it("menjawab jujur saat tidak ada catatan audit (bukan mengarang)", async () => {
    mockAuditFindMany.mockResolvedValue([]);
    mockAuditCount.mockResolvedValue(0);

    const res = await processChat(input("Siapa saja pengguna yang dihapus pada 18 Oktober 2026?"));

    expect(res.intent).toBe("USER_AUDIT");
    expect(res.message).toContain("Tidak ada catatan audit");
  });

  it("tidak menyamarkan kegagalan query sebagai hasil kosong", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockAuditFindMany.mockRejectedValue(new Error("db down"));

    const res = await processChat(input("Siapa saja pengguna yang dihapus pada 18 Oktober 2026?"));

    expect(res.intent).toBe("USER_AUDIT");
    expect(res.message).toBe(USER_AUDIT_UNAVAILABLE);
    expect(res.message).not.toContain("Tidak ada catatan audit");
    spy.mockRestore();
  });

  it("meminta klarifikasi untuk tanggal parsial tanpa menebak", async () => {
    const res = await processChat(input("Siapa saja pengguna yang dihapus tanggal 18?"));

    expect(res.intent).toBe("USER_AUDIT");
    expect(res.message).toContain("tanpa bulan dan tahun");
    expect(mockAuditFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2-6. Non-admin TIDAK dapat mengakses audit
// ---------------------------------------------------------------------------

describe("Non-ADMIN — akses audit ditolak di server", () => {
  const nonAdmins = ["LIBRARIAN", "TEACHER", "STUDENT", "STAFF"] as const;

  it.each(nonAdmins)("menolak role %s dan tidak pernah menyentuh AuditLog", async (role) => {
    mockFindUnique.mockResolvedValue(account(role));

    const res = await processChat(input("Siapa saja pengguna yang dihapus hari ini?"));

    expect(res.intent).toBe("USER_AUDIT");
    expect(res.message).toBe(AUDIT_ADMIN_ONLY);
    expect(mockAuditFindMany).not.toHaveBeenCalled();
    expect(mockAuditCount).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("tidak mengungkapkan identitas atau keberadaan akun tertentu pada penolakan", async () => {
    mockFindUnique.mockResolvedValue(account("TEACHER"));

    for (const content of [
      "Siapa yang menghapus akun najla@sma.id?",
      "Apakah akun najla@sma.id pernah dihapus?",
      "Kapan akun Najla dibuat?",
    ]) {
      const res = await processChat(input(content));
      expect(res.message).toBe(AUDIT_ADMIN_ONLY);
      expect(res.message.toLowerCase()).not.toContain("najla");
    }
  });

  it("tidak membocorkan audit lewat riwayat percakapan", async () => {
    mockFindUnique.mockResolvedValue(account("LIBRARIAN"));

    const res = await processChat(
      historyInput(
        [{ role: "assistant", content: "najla@sma.id dihapus oleh Admin Utama pukul 15:20 WIB" }],
        "Siapa yang dihapus hari ini?"
      )
    );

    expect(res.message).toBe(AUDIT_ADMIN_ONLY);
    expect(res.message).not.toContain("najla");
    expect(res.message).not.toContain("Admin Utama");
  });

  it("riwayat pembuatan dan penghapusan pengguna tetap ditolak untuk siswa", async () => {
    mockFindUnique.mockResolvedValue(account("STUDENT"));

    const res = await processChat(input("Tampilkan riwayat pembuatan dan penghapusan pengguna."));

    expect(res.message).toBe(AUDIT_ADMIN_ONLY);
    expect(mockAuditFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6-8. Route HTTP: tanpa sesi, role palsu, dan jalur alternatif tool
// ---------------------------------------------------------------------------

describe("Route /api/ai/chat — otorisasi audit", () => {
  it("menolak request tanpa autentikasi (401) tanpa menyentuh AuditLog", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await POST(post({ messages: [{ role: "user", content: "Siapa yang dihapus?" }] }));

    expect(res.status).toBe(401);
    expect(mockAuditFindMany).not.toHaveBeenCalled();
  });

  it("role ADMIN palsu di body TIDAK memberi akses (role dari sesi/DB)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role: "STUDENT" } });
    mockFindUnique.mockResolvedValue(account("STUDENT"));

    const res = await POST(
      post({
        role: "ADMIN",
        messages: [{ role: "user", content: "Siapa saja pengguna yang dihapus hari ini?" }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe(AUDIT_ADMIN_ONLY);
    expect(mockAuditFindMany).not.toHaveBeenCalled();
  });

  it("JWT yang mengklaim ADMIN tetap ditolak bila role DB bukan ADMIN (stale claim)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role: "ADMIN" } });
    mockFindUnique.mockResolvedValue(account("LIBRARIAN"));

    const res = await POST(
      post({ messages: [{ role: "user", content: "Siapa saja pengguna yang dihapus hari ini?" }] })
    );
    const body = await res.json();

    expect(body.message).toBe(AUDIT_ADMIN_ONLY);
    expect(mockAuditFindMany).not.toHaveBeenCalled();
  });

  it("ADMIN terautentikasi menerima riwayat audit dari DB", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role: "ADMIN" } });
    mockFindUnique.mockResolvedValue(account("ADMIN", { name: "Admin Utama" }));
    mockAuditFindMany.mockResolvedValue([auditRow()]);
    mockAuditCount.mockResolvedValue(1);
    mockUserFindMany.mockResolvedValue([
      {
        email: "najla@sma.id",
        name: "Najla",
        role: "STUDENT",
        createdAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    ]);

    const res = await POST(
      post({ messages: [{ role: "user", content: "Siapa saja pengguna yang dihapus pada 18 Oktober 2026?" }] })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain("Najla");
    expect(body.message).not.toContain("najla@sma.id");
    expect(mockAuditFindMany).toHaveBeenCalled();
  });
});

describe("Tool audit tidak dapat dipanggil non-admin (jalur alternatif)", () => {
  it("executeTool menolak LIBRARIAN/TEACHER/STUDENT/STAFF", async () => {
    for (const role of ["LIBRARIAN", "TEACHER", "STUDENT", "STAFF"]) {
      const raw = await executeTool("get_user_audit_history", {}, USER_ID, role);
      const data = JSON.parse(raw) as { error?: string };
      expect(data.error).toContain("Akses ditolak");
    }
    expect(mockAuditFindMany).not.toHaveBeenCalled();
  });

  it("tool hanya terdaftar untuk ADMIN", () => {
    const names = (role: string) => toolsForRole(role).map((t) => t.function.name);
    expect(names("ADMIN")).toContain("get_user_audit_history");
    for (const role of ["LIBRARIAN", "TEACHER", "STUDENT", "STAFF"]) {
      expect(names(role)).not.toContain("get_user_audit_history");
    }
  });

  it("ADMIN dapat memanggil tool dan menerima data tersanitasi", async () => {
    mockAuditFindMany.mockResolvedValue([auditRow()]);
    mockAuditCount.mockResolvedValue(1);
    mockUserFindMany.mockResolvedValue([
      {
        email: "najla@sma.id",
        name: "Najla",
        role: "STUDENT",
        createdAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    ]);

    const raw = await executeTool("get_user_audit_history", { type: "DELETE" }, USER_ID, "ADMIN");
    const data = JSON.parse(raw) as {
      count?: number;
      events?: Array<Record<string, unknown>>;
    };

    expect(data.count).toBe(1);
    expect(data.events?.[0]).toMatchObject({
      action: "DELETE_USER",
      targetName: "Najla",
      targetRole: "STUDENT",
      actorName: "Admin Utama",
      actorRole: "ADMIN",
      at: "2026-10-18 15:20 WIB",
    });
    // Email target tidak pernah ada di payload tool.
    expect(data.events?.[0]).not.toHaveProperty("targetEmail");
    const serialized = JSON.stringify(data).toLowerCase();
    expect(serialized).not.toContain("najla@sma.id");
    // Tidak ada kredensial pada payload.
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
  });
});

// ---------------------------------------------------------------------------
// 10. Filter tanggal & konversi WIB ("hari ini")
// ---------------------------------------------------------------------------

describe("Filter tanggal 'hari ini' memakai zona Asia/Jakarta", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 2026-10-18 11:00 WIB
    jest.setSystemTime(new Date("2026-10-18T04:00:00.000Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("membatasi query AuditLog ke tengah malam lokal Jakarta (bukan UTC)", async () => {
    mockFindUnique.mockResolvedValue(account("ADMIN"));
    mockAuditFindMany.mockResolvedValue([]);
    mockAuditCount.mockResolvedValue(0);

    await processChat(input("Akun apa saja yang dibuat hari ini?"));

    expect(mockAuditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: { in: ["CREATE_USER", "REGISTER_STUDENT"] },
          createdAt: {
            gte: new Date("2026-10-17T17:00:00.000Z"),
            lt: new Date("2026-10-18T17:00:00.000Z"),
          },
        }),
      })
    );
  });
});
