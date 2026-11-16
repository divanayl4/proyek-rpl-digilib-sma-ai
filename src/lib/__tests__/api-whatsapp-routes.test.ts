/**
 * API route tests for the WhatsApp integration:
 * - ADMIN-only configuration/history/announcement endpoints (RBAC).
 * - Token and full phone numbers never appear in HTTP responses.
 * - User verification always uses the session identity, never a body userId.
 */

const mockSettings = new Map<string, string>();
const mockGetServerSession = jest.fn();
const mockAuditCreate = jest.fn(async () => ({}));

const mockUserFindMany = jest.fn(async () => [] as unknown[]);
const mockUserCount = jest.fn(async () => 0);
const mockUserFindUnique = jest.fn(async () => null as unknown);
const mockUserFindFirst = jest.fn(async () => null as unknown);
const mockUserUpdate = jest.fn(async () => ({}));

const mockRequestVerification = jest.fn();
const mockConfirmVerification = jest.fn();
const mockBroadcast = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    setting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
        const value = mockSettings.get(where.key);
        return value !== undefined ? { key: where.key, value } : null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: { value: string };
          update: { value: string };
        }) => {
          mockSettings.set(where.key, mockSettings.has(where.key) ? update.value : create.value);
          return {};
        }
      ),
      deleteMany: jest.fn(async ({ where }: { where: { key: string } }) => {
        const existed = mockSettings.delete(where.key);
        return { count: existed ? 1 : 0 };
      }),
    },
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...(args as [])),
      count: (...args: unknown[]) => mockUserCount(...(args as [])),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...(args as [])),
      findFirst: (...args: unknown[]) => mockUserFindFirst(...(args as [])),
      update: (...args: unknown[]) => mockUserUpdate(...(args as [])),
    },
    auditLog: { create: mockAuditCreate },
    notification: { createMany: jest.fn(async () => ({ count: 0 })) },
    whatsAppDelivery: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      groupBy: jest.fn(async () => []),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
  },
}));

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/whatsapp", () => {
  const actual = jest.requireActual("@/lib/whatsapp");
  return {
    ...actual,
    requestWhatsAppVerification: (...args: unknown[]) =>
      mockRequestVerification(...args),
    confirmWhatsAppVerification: (...args: unknown[]) =>
      mockConfirmVerification(...args),
    broadcastWhatsAppNotification: (...args: unknown[]) => mockBroadcast(...args),
  };
});

import { GET as getConfig, PATCH as patchConfig } from "@/app/api/admin/whatsapp/config/route";
import { GET as getUsers } from "@/app/api/admin/whatsapp/users/route";
import { PATCH as patchUser } from "@/app/api/admin/whatsapp/users/[id]/route";
import { POST as postAnnouncement } from "@/app/api/admin/whatsapp/announcements/route";
import { POST as requestCode, PUT as confirmCode } from "@/app/api/whatsapp/verify/route";
import { PATCH as patchPreference, DELETE as unlink } from "@/app/api/whatsapp/link/route";

const originalEnv = { ...process.env };

function adminSession() {
  return { user: { id: "admin-1", role: "ADMIN" } };
}

function jsonRequest(body: unknown, url = "http://localhost:3000/api/test") {
  return {
    url,
    json: async () => body,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.clear();
  process.env = { ...originalEnv };
  process.env.FONNTE_API_TOKEN = "env-secret-token-value";
  process.env.FONNTE_ADMIN_NUMBER = "628111222333";
  process.env.FONNTE_ENABLED = "true";
  process.env.NEXTAUTH_SECRET = "unit-test-nextauth-secret";

  mockGetServerSession.mockResolvedValue(adminSession());
  mockUserFindMany.mockResolvedValue([]);
  mockUserCount.mockResolvedValue(0);
  mockUserFindUnique.mockResolvedValue(null);
  mockUserFindFirst.mockResolvedValue(null);
  mockUserUpdate.mockResolvedValue({});
  mockBroadcast.mockResolvedValue({
    batchId: "batch-1",
    targetedUsers: 0,
    inAppCreated: 0,
    whatsappSent: 0,
    whatsappSkipped: 0,
    whatsappFailed: 0,
  });
});

afterAll(() => {
  process.env = originalEnv;
});

describe("GET /api/admin/whatsapp/config", () => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getConfig();
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin roles", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const res = await getConfig();
    expect(res.status).toBe(403);
  });

  it("never exposes the full token to the client", async () => {
    const res = await getConfig();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("env-secret-token-value");
    const data = JSON.parse(text);
    expect(data.config.configured).toBe(true);
    expect(data.config.tokenMasked).toBe("••••alue");
    expect(data.config.adminNumber).toBe("628111222333");
  });
});

describe("PATCH /api/admin/whatsapp/config", () => {
  it("rejects an invalid admin number", async () => {
    const res = await patchConfig(jsonRequest({ adminNumber: "12345" }));
    expect(res.status).toBe(400);
  });

  it("rejects unknown notification categories", async () => {
    const res = await patchConfig(jsonRequest({ enabledCategories: ["HACK"] }));
    expect(res.status).toBe(400);
  });

  it("stores an encrypted token and never echoes it", async () => {
    const res = await patchConfig(
      jsonRequest({
        token: "brand-new-fonnte-token",
        adminNumber: "081234567890",
        enabled: true,
        enabledCategories: ["ACCOUNT", "BORROW"],
      })
    );
    expect(res.status).toBe(200);

    const stored = mockSettings.get("whatsapp.fonnteToken");
    expect(stored).toBeDefined();
    expect(stored).not.toBe("brand-new-fonnte-token");
    expect(mockSettings.get("whatsapp.adminNumber")).toBe("6281234567890");

    const text = await res.text();
    expect(text).not.toContain("brand-new-fonnte-token");
  });
});

describe("GET /api/admin/whatsapp/users", () => {
  it("returns 403 for non-admin roles", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const res = await getUsers(jsonRequest(null, "http://localhost:3000/api/admin/whatsapp/users"));
    expect(res.status).toBe(403);
  });

  it("masks phone numbers and never includes the full value", async () => {
    mockUserFindMany.mockResolvedValue([
      {
        id: "u1",
        name: "Siswa",
        email: "siswa@sma.id",
        role: "STUDENT",
        isActive: true,
        whatsappNumber: "6281234567890",
        whatsappVerified: true,
        whatsappVerifiedAt: new Date(),
        whatsappNotificationsEnabled: true,
      },
    ]);

    const res = await getUsers(jsonRequest(null, "http://localhost:3000/api/admin/whatsapp/users"));
    const text = await res.text();
    expect(text).not.toContain("6281234567890");
    const data = JSON.parse(text);
    expect(data.users[0].whatsappNumberMasked).toBe("6281••••••890");
    expect(data.users[0].hasWhatsappNumber).toBe(true);
  });
});

describe("PATCH /api/admin/whatsapp/users/[id]", () => {
  const params = { params: { id: "u1" } };

  it("returns 403 for non-admin roles", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const res = await patchUser(jsonRequest({ whatsappNumber: "081234567890" }), params);
    expect(res.status).toBe(403);
  });

  it("rejects a number already used by another account", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u1",
      email: "siswa@sma.id",
      whatsappNumber: null,
    });
    mockUserFindFirst.mockResolvedValue({ id: "other" });

    const res = await patchUser(jsonRequest({ whatsappNumber: "081234567890" }), params);
    expect(res.status).toBe(409);
  });

  it("normalizes and verifies a number set by an admin", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u1",
      email: "siswa@sma.id",
      whatsappNumber: null,
    });
    mockUserUpdate.mockResolvedValue({
      id: "u1",
      name: "Siswa",
      email: "siswa@sma.id",
      role: "STUDENT",
      whatsappNumber: "6281234567890",
      whatsappVerified: true,
      whatsappVerifiedAt: new Date(),
      whatsappNotificationsEnabled: true,
    });

    const res = await patchUser(
      jsonRequest({ whatsappNumber: "081234567890", verified: true }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({
          whatsappNumber: "6281234567890",
          whatsappVerified: true,
        }),
      })
    );

    const text = await res.text();
    expect(text).not.toContain("6281234567890");
    expect(JSON.parse(text).user.whatsappNumberMasked).toBe("6281••••••890");
  });
});

describe("POST /api/admin/whatsapp/announcements", () => {
  it("returns 403 for non-admin roles", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "l1", role: "LIBRARIAN" } });
    const res = await postAnnouncement(
      jsonRequest({ title: "Info", message: "Isi", audience: "ALL" })
    );
    expect(res.status).toBe(403);
  });

  it("validates required fields", async () => {
    const res = await postAnnouncement(jsonRequest({ title: "", message: "", audience: "ALL" }));
    expect(res.status).toBe(400);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("broadcasts with the selected category", async () => {
    const res = await postAnnouncement(
      jsonRequest({
        title: "Perpustakaan Tutup",
        message: "Tutup sementara besok.",
        audience: "ROLE",
        role: "STUDENT",
        category: "MAINTENANCE",
      })
    );
    expect(res.status).toBe(200);
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Perpustakaan Tutup",
        audience: "ROLE",
        role: "STUDENT",
        category: "MAINTENANCE",
      })
    );
  });
});

describe("/api/whatsapp/verify", () => {
  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await requestCode(jsonRequest({ number: "081234567890" }));
    expect(res.status).toBe(401);
  });

  it("always requests verification for the session user", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "session-user", role: "STUDENT" } });
    mockRequestVerification.mockResolvedValue({
      ok: true,
      message: "Kode terkirim.",
      maskedNumber: "6281••••••890",
    });

    const res = await requestCode(
      jsonRequest({ number: "081234567890", userId: "someone-else" })
    );
    expect(res.status).toBe(200);
    expect(mockRequestVerification).toHaveBeenCalledWith("session-user", "081234567890");
  });

  it("confirms codes for the session user only", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "session-user", role: "STUDENT" } });
    mockConfirmVerification.mockResolvedValue({
      ok: true,
      message: "Nomor terverifikasi.",
      maskedNumber: "6281••••••890",
    });

    const res = await confirmCode(
      jsonRequest({ number: "081234567890", code: "123456", userId: "someone-else" })
    );
    expect(res.status).toBe(200);
    expect(mockConfirmVerification).toHaveBeenCalledWith(
      "session-user",
      "081234567890",
      "123456"
    );
  });
});

describe("/api/whatsapp/link", () => {
  it("refuses to toggle notifications without a verified number", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    mockUserFindUnique.mockResolvedValue({ whatsappNumber: null, whatsappVerified: false });

    const res = await patchPreference(jsonRequest({ enabled: false }));
    expect(res.status).toBe(400);
  });

  it("unlinking only clears WhatsApp fields", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    mockUserFindUnique.mockResolvedValue({
      whatsappNumber: "6281234567890",
      whatsappVerificationCodeHash: null,
    });

    const res = await unlink();
    expect(res.status).toBe(200);
    const data = (mockUserUpdate.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ])[0];
    expect(data.data.whatsappNumber).toBeNull();
    expect(data.data.whatsappVerified).toBe(false);
    expect(data.data).not.toHaveProperty("name");
    expect(data.data).not.toHaveProperty("email");
    expect(data.data).not.toHaveProperty("passwordHash");
  });
});
