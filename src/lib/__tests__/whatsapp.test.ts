/**
 * Unit tests for the central WhatsApp/Fonnte service.
 *
 * `fetch` and Prisma are mocked: no real network/database access. The crucial
 * contract is that a send is only successful when Fonnte's JSON payload says so
 * (not merely HTTP 200), and that delivery history/anti-duplicate works.
 */

const settings = new Map<string, string>();
let userState: Record<string, unknown> | null = null;

const mockSettingFindUnique = jest.fn(async () => null as unknown);
const mockSettingUpsert = jest.fn(async () => ({}));
const mockSettingDeleteMany = jest.fn(async () => ({ count: 0 }));
const mockUserFindUnique = jest.fn(async () => userState);
const mockUserFindFirst = jest.fn(async () => null as unknown);
const mockUserUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
  userState = { ...(userState ?? {}), ...data };
  return userState;
});
const mockDeliveryCreate = jest.fn(async () => ({}));
const mockDeliveryUpdate = jest.fn(async () => ({}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    setting: {
      findUnique: (...args: unknown[]) => mockSettingFindUnique(...(args as [])),
      upsert: (...args: unknown[]) => mockSettingUpsert(...(args as [])),
      deleteMany: (...args: unknown[]) => mockSettingDeleteMany(...(args as [])),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...(args as [])),
      findFirst: (...args: unknown[]) => mockUserFindFirst(...(args as [])),
      update: (...args: unknown[]) =>
        mockUserUpdate(...(args as [{ data: Record<string, unknown> }])),
    },
    whatsAppDelivery: {
      create: (...args: unknown[]) => mockDeliveryCreate(...(args as [])),
      update: (...args: unknown[]) => mockDeliveryUpdate(...(args as [])),
    },
  },
}));

jest.mock("@/lib/ai/configCrypto", () => ({
  // Envelope sederhana untuk pengujian: "enc:<token>".
  decryptSecret: (value: string | null | undefined) =>
    typeof value === "string" && value.startsWith("enc:") ? value.slice(4) : null,
  encryptSecret: (value: string) => `enc:${value}`,
}));

import {
  codesMatch,
  confirmWhatsAppVerification,
  deliverWhatsAppNotification,
  getWhatsAppConfig,
  hashVerificationCode,
  maskPhoneNumber,
  maskSecret,
  normalizeWhatsAppNumber,
  requestWhatsAppVerification,
  saveWhatsAppConfig,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";

const originalEnv = { ...process.env };

function setEnv(token = "env-token", admin = "628111222333", enabled = "true") {
  process.env.FONNTE_API_TOKEN = token;
  process.env.FONNTE_ADMIN_NUMBER = admin;
  process.env.FONNTE_ENABLED = enabled;
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  settings.clear();
  userState = null;
  process.env = { ...originalEnv };
  setEnv();

  mockSettingFindUnique.mockImplementation((async (args: {
    where: { key: string };
  }) => {
    const value = settings.get(args.where.key);
    return value !== undefined ? { key: args.where.key, value } : null;
  }) as never);
  mockSettingUpsert.mockImplementation((async (args: {
    where: { key: string };
    create: { value: string };
    update: { value: string };
  }) => {
    settings.set(args.where.key, args.create?.value ?? args.update?.value);
    return {};
  }) as never);
  mockUserFindUnique.mockImplementation((async () => userState) as never);
  mockUserUpdate.mockImplementation((async (args: {
    data: Record<string, unknown>;
  }) => {
    userState = { ...(userState ?? {}), ...args.data };
    return userState;
  }) as never);
  mockDeliveryCreate.mockResolvedValue({});
  mockDeliveryUpdate.mockResolvedValue({});
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterAll(() => {
  process.env = originalEnv;
});

describe("normalizeWhatsAppNumber", () => {
  it.each([
    ["081234567890", "6281234567890"],
    ["81234567890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["+62 812-3456-7890", "6281234567890"],
    ["0812.3456.7890", "6281234567890"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeWhatsAppNumber(input)).toBe(expected);
  });

  it.each(["", "abc", "12345", "+1234567890", "0212345678", "628"])(
    "rejects invalid %s",
    (input) => {
      expect(normalizeWhatsAppNumber(input)).toBeNull();
    }
  );
});

describe("masking", () => {
  it("masks a phone number without revealing the middle", () => {
    expect(maskPhoneNumber("6281234567890")).toBe("6281••••••890");
    expect(maskPhoneNumber(null)).toBeNull();
  });

  it("never returns a full token", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("••••mnop");
    expect(maskSecret("abc")).toBe("••••");
    expect(maskSecret(null)).toBeNull();
  });
});

describe("getWhatsAppConfig", () => {
  it("falls back to environment values", async () => {
    const config = await getWhatsAppConfig();
    expect(config.token).toBe("env-token");
    expect(config.adminNumber).toBe("628111222333");
    expect(config.tokenSource).toBe("environment");
    expect(config.enabled).toBe(true);
  });

  it("prefers encrypted database settings over environment", async () => {
    settings.set("whatsapp.fonnteToken", "enc:db-token");
    settings.set("whatsapp.adminNumber", "628999888777");
    settings.set("whatsapp.enabled", "false");
    settings.set("whatsapp.enabledCategories", JSON.stringify(["BORROW"]));

    const config = await getWhatsAppConfig();
    expect(config.token).toBe("db-token");
    expect(config.tokenSource).toBe("database");
    expect(config.adminNumber).toBe("628999888777");
    expect(config.adminNumberSource).toBe("database");
    expect(config.enabled).toBe(false);
    expect(config.enabledCategories).toEqual(["BORROW"]);
  });

  it("ignores legacy plaintext tokens in the database", async () => {
    settings.set("whatsapp.fonnteToken", "plaintext-token");
    const config = await getWhatsAppConfig();
    expect(config.token).toBe("env-token");
    expect(config.tokenSource).toBe("environment");
  });
});

describe("saveWhatsAppConfig", () => {
  it("encrypts the token and never returns it", async () => {
    const summary = await saveWhatsAppConfig({
      token: "new-secret-token",
      adminNumber: "081234567890",
      enabled: true,
      enabledCategories: ["ACCOUNT", "BORROW"],
    });

    expect(settings.get("whatsapp.fonnteToken")).toBe("enc:new-secret-token");
    expect(settings.get("whatsapp.adminNumber")).toBe("6281234567890");
    expect(JSON.stringify(summary)).not.toContain("new-secret-token");
    expect(summary.tokenMasked).toBe("••••oken");
  });

  it("rejects an invalid admin number", async () => {
    await expect(
      saveWhatsAppConfig({ adminNumber: "12345" })
    ).rejects.toThrow("tidak valid");
  });
});

describe("sendWhatsAppMessage", () => {
  it("treats HTTP 200 without a success status as failure", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ status: false, reason: "device disconnected" })
    );

    const result = await sendWhatsAppMessage("081234567890", "Halo");
    expect(result.ok).toBe(false);
    expect(result.providerStatus).toBe("REJECTED");
    expect(result.error).toContain("device disconnected");
  });

  it("treats HTTP 500 as failure", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ status: false, reason: "server error" }, 500)
    );
    const result = await sendWhatsAppMessage("081234567890", "Halo");
    expect(result.ok).toBe(false);
    expect(result.providerStatus).toBe("HTTP 500");
  });

  it("accepts a Fonnte success payload and extracts the message id", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ status: true, id: [12345], process: "sent" })
    );

    const result = await sendWhatsAppMessage("081234567890", "Halo");
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe("12345");
    expect(result.providerStatus).toBe("sent");

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe("env-token");
    expect(String(init.body)).toContain("target=6281234567890");
  });

  it("rejects invalid recipient numbers before calling Fonnte", async () => {
    const result = await sendWhatsAppMessage("12345", "Halo");
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("deliverWhatsAppNotification", () => {
  const base = {
    userId: "u1",
    title: "Peminjaman Berhasil",
    message: "Buku dipinjam.",
    eventKey: "borrow:approve:b1",
    category: "BORROW" as const,
  };

  function verifiedUser() {
    userState = {
      id: "u1",
      role: "STUDENT",
      isActive: true,
      whatsappNumber: "6281234567890",
      whatsappVerified: true,
      whatsappNotificationsEnabled: true,
    };
  }

  it("does not send when configuration is disabled", async () => {
    setEnv("env-token", "628111222333", "false");
    const result = await deliverWhatsAppNotification(base);
    expect(result).toEqual({ sent: false, reason: "DISABLED" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockDeliveryCreate).not.toHaveBeenCalled();
  });

  it("does not send a category that is turned off", async () => {
    settings.set("whatsapp.enabledCategories", JSON.stringify(["ACCOUNT"]));
    const result = await deliverWhatsAppNotification(base);
    expect(result).toEqual({ sent: false, reason: "DISABLED" });
  });

  it("records SKIPPED when the user has no verified number", async () => {
    userState = {
      id: "u1",
      role: "STUDENT",
      isActive: true,
      whatsappNumber: null,
      whatsappVerified: false,
      whatsappNotificationsEnabled: true,
    };

    const result = await deliverWhatsAppNotification(base);
    expect(result.sent).toBe(false);
    expect(result.status).toBe("SKIPPED");
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventKey: base.eventKey },
        data: expect.objectContaining({ status: "SKIPPED" }),
      })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("stops duplicates via the unique eventKey claim", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "P2002" });
    mockDeliveryCreate.mockRejectedValueOnce(duplicate);

    const result = await deliverWhatsAppNotification(base);
    expect(result).toEqual({ sent: false, reason: "DUPLICATE", status: "SKIPPED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("records SENT only when Fonnte replies with success", async () => {
    verifiedUser();
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ status: true, id: 99, process: "sent" })
    );

    const result = await deliverWhatsAppNotification(base);
    expect(result).toEqual({ sent: true, status: "SENT" });
    expect(mockDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventKey: base.eventKey, status: "PENDING" }),
      })
    );
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventKey: base.eventKey },
        data: expect.objectContaining({ status: "SENT", providerMessageId: "99" }),
      })
    );
  });

  it("records FAILED when Fonnte rejects the message", async () => {
    verifiedUser();
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ status: false, reason: "invalid target" })
    );

    const result = await deliverWhatsAppNotification(base);
    expect(result).toEqual({ sent: false, reason: "FAILED", status: "FAILED" });
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", errorMessage: "invalid target" }),
      })
    );
  });
});

describe("verification codes", () => {
  it("hashes deterministically and compares safely", () => {
    const hash = hashVerificationCode("u1", "6281234567890", "123456");
    expect(hash).toHaveLength(64);
    expect(hashVerificationCode("u1", "6281234567890", "123456")).toBe(hash);
    expect(codesMatch(hash, hash)).toBe(true);
    expect(
      codesMatch(hash, hashVerificationCode("u1", "6281234567890", "654321"))
    ).toBe(false);
  });

  it("confirm only stores the number when the code matches", async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    userState = {
      id: "u1",
      whatsappVerificationCodeHash: hashVerificationCode("u1", "6281234567890", "123456"),
      whatsappVerificationExpiresAt: future,
      whatsappVerificationAttempts: 0,
    };
    mockUserFindFirst.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ status: true, id: 1 }));

    const wrong = await confirmWhatsAppVerification("u1", "081234567890", "000000");
    expect(wrong.ok).toBe(false);
    expect(userState?.whatsappNumber).toBeUndefined();

    userState = {
      ...(userState ?? {}),
      whatsappVerificationCodeHash: hashVerificationCode("u1", "6281234567890", "123456"),
      whatsappVerificationExpiresAt: future,
      whatsappVerificationAttempts: 0,
    };

    const ok = await confirmWhatsAppVerification("u1", "081234567890", "123456");
    expect(ok.ok).toBe(true);
    expect(userState?.whatsappNumber).toBe("6281234567890");
    expect(userState?.whatsappVerified).toBe(true);
    expect(userState?.whatsappVerificationCodeHash).toBeNull();
  });

  it("rejects an expired code", async () => {
    userState = {
      id: "u1",
      whatsappVerificationCodeHash: "x",
      whatsappVerificationExpiresAt: new Date(Date.now() - 1000),
      whatsappVerificationAttempts: 0,
    };
    const result = await confirmWhatsAppVerification("u1", "081234567890", "123456");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("kedaluwarsa");
  });

  it("requests a code, records history, and stores only its hash", async () => {
    userState = {
      id: "u1",
      isActive: true,
      whatsappVerificationSentAt: null,
      whatsappVerificationCodeHash: null,
    };
    mockUserFindFirst.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ status: true, id: "msg-1", process: "sent" })
    );

    const result = await requestWhatsAppVerification("u1", "081234567890");
    expect(result.ok).toBe(true);
    expect(userState?.whatsappVerificationCodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(String(userState?.whatsappVerificationCodeHash)).not.toMatch(/^\d{6}$/);
    expect(mockDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "ACCOUNT",
          recipientNumber: "6281234567890",
          status: "PENDING",
        }),
      })
    );

    const body = String((global.fetch as jest.Mock).mock.calls[0][1].body);
    const decoded = decodeURIComponent(body.replace(/\+/g, " "));
    const code = decoded.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeDefined();
    expect(userState?.whatsappVerificationCodeHash).toBe(
      hashVerificationCode("u1", "6281234567890", code as string)
    );
  });

  it("does not allow a number already used by another account", async () => {
    userState = {
      id: "u1",
      isActive: true,
      whatsappVerificationSentAt: null,
      whatsappVerificationCodeHash: null,
    };
    mockUserFindFirst.mockResolvedValue({ id: "other" });

    const result = await requestWhatsAppVerification("u1", "081234567890");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("sudah digunakan");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
