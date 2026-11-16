/**
 * Security tests for the Telegram linking endpoints.
 *
 * Semua jaringan dan database di-mock: `sendTelegramChatMessage` (Tanpa panggil
 * Telegram API nyata) dan Prisma di-mock. Tidak ada data pengguna yang berubah.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

const mockUserUpdate = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockUserFindUnique = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: (...args: unknown[]) => mockUserUpdate(...args),
      updateMany: (...args: unknown[]) => mockUserUpdateMany(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

const mockSendChat = jest.fn();

// Pertahankan implementasi asli (isTelegramEnabled, isTelegramRecipientRole),
// hanya ganti pengiriman agar tidak menyentuh Telegram API.
jest.mock("@/lib/telegram", () => {
  const actual = jest.requireActual("@/lib/telegram");
  return {
    ...actual,
    sendTelegramChatMessage: (...args: unknown[]) => mockSendChat(...args),
  };
});

import { POST as linkPost, DELETE as unlinkDelete } from "@/app/api/telegram/link/route";
import { POST as webhookPost } from "@/app/api/telegram/webhook/route";

const SECRET = "unit-test-webhook-secret";
const LINK_URL = "http://localhost:3000/api/telegram/link";
const WEBHOOK_URL = "http://localhost:3000/api/telegram/webhook";
const START_WELCOME =
  "Hai, selamat datang di DigiLib SMA Bot. Selamat membaca, enjoy your books! 🫵🤓";

function webhookReq(body: unknown, secret?: string) {
  return new NextRequest(WEBHOOK_URL, {
    method: "POST",
    headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
    body: JSON.stringify(body),
  });
}

function linkReq() {
  return new NextRequest(LINK_URL, { method: "POST" });
}

function unlinkReq(query = "") {
  return new NextRequest(`${LINK_URL}${query}`, { method: "DELETE" });
}

function startUpdate(text: string, chatId: number | string) {
  return { message: { text, chat: { id: chatId } } };
}

function successReplies() {
  return mockSendChat.mock.calls.filter(([, text]) =>
    String(text).includes("berhasil dihubungkan")
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "unit-test-token";
  process.env.TELEGRAM_ENABLED = "true";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  mockUserUpdate.mockResolvedValue({});
  mockUserUpdateMany.mockResolvedValue({ count: 1 });
  mockUserFindUnique.mockResolvedValue({
    telegramChatId: "111",
    telegramLinkCode: null,
  });
  mockSendChat.mockResolvedValue(true);
});

afterAll(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ENABLED;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

describe("POST /api/telegram/webhook – secret", () => {
  it("processes a valid /start when the secret matches", async () => {
    const res = await webhookPost(webhookReq(startUpdate("/start code-1", 111), SECRET));

    expect(res.status).toBe(200);
    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    expect(successReplies()).toHaveLength(1);
    expect(mockSendChat).toHaveBeenCalledWith(111, expect.stringContaining("berhasil"));
  });

  it("ignores the update when the secret is wrong", async () => {
    await webhookPost(webhookReq(startUpdate("/start code-1", 222), "wrong-secret"));

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockSendChat).not.toHaveBeenCalled();
  });

  it("refuses to process when the secret is not configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    await webhookPost(webhookReq(startUpdate("/start code-1", 333), SECRET));

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockSendChat).not.toHaveBeenCalled();
  });
});

describe("POST /api/telegram/webhook – perintah /start", () => {
  it("replies with the exact welcome text and nothing else", async () => {
    const res = await webhookPost(webhookReq(startUpdate("/start", 700), SECRET));

    expect(res.status).toBe(200);
    expect(mockSendChat).toHaveBeenCalledTimes(1);
    expect(mockSendChat).toHaveBeenCalledWith(700, START_WELCOME);
  });

  it("replies every time /start is sent", async () => {
    await webhookPost(webhookReq(startUpdate("/start", 701), SECRET));
    await webhookPost(webhookReq(startUpdate("/start", 701), SECRET));

    expect(mockSendChat).toHaveBeenCalledTimes(2);
    expect(mockSendChat.mock.calls.map(([, text]) => text)).toEqual([
      START_WELCOME,
      START_WELCOME,
    ]);
  });

  it("does not link an account automatically on plain /start", async () => {
    await webhookPost(webhookReq(startUpdate("/start", 702), SECRET));

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("supports the /start@botname form without linking", async () => {
    await webhookPost(webhookReq(startUpdate("/start@DigiLibSMA_bot", 703), SECRET));

    expect(mockSendChat).toHaveBeenCalledWith(703, START_WELCOME);
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it("treats an empty/whitespace parameter as plain /start", async () => {
    for (const text of ["/start ", "/start     ", "/start\n", "/start\t\t", "/start@DigiLibSMA_bot   "]) {
      await webhookPost(webhookReq(startUpdate(text, 705), SECRET));
    }

    expect(mockSendChat).toHaveBeenCalledTimes(5);
    for (const [, message] of mockSendChat.mock.calls) {
      expect(message).toBe(START_WELCOME);
    }
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it("never claims a pending code on plain /start, even after the account was linked", async () => {
    // Kode masih tersimpan di akun (mis. baru dibuat ulang), tetapi /start tanpa
    // payload tidak boleh memakainya.
    mockUserFindUnique.mockResolvedValue({
      telegramChatId: "111",
      telegramLinkCode: "a1eaef40",
    });

    await webhookPost(webhookReq(startUpdate("/start", 706), SECRET));

    expect(mockSendChat).toHaveBeenCalledWith(706, START_WELCOME);
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("ignores unrelated messages so notification handling is untouched", async () => {
    await webhookPost(webhookReq(startUpdate("halo bot", 704), SECRET));

    expect(mockSendChat).not.toHaveBeenCalled();
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/telegram/webhook – kode linking", () => {
  it("requires the code to be unexpired in the atomic claim", async () => {
    mockUserUpdateMany.mockResolvedValue({ count: 0 });

    await webhookPost(webhookReq(startUpdate("/start old-code", 444), SECRET));

    const where = mockUserUpdateMany.mock.calls[0][0].where;
    expect(where.telegramLinkCode).toBe("old-code");
    expect(where.telegramLinkCodeExpiresAt).toEqual({ gt: expect.any(Date) });

    expect(successReplies()).toHaveLength(0);
    expect(mockSendChat).toHaveBeenCalledWith(444, expect.stringContaining("tidak valid"));
  });

  it("does not link a code that was already consumed", async () => {
    // Kode yang sudah dipakai tidak lagi cocok → count 0.
    mockUserUpdateMany.mockResolvedValue({ count: 0 });

    await webhookPost(webhookReq(startUpdate("/start used-code", 555), SECRET));

    expect(successReplies()).toHaveLength(0);
  });

  it("lets at most one concurrent request claim the same code", async () => {
    let claimed = false;
    mockUserUpdateMany.mockImplementation(async ({ where }: { where: { telegramLinkCode?: string } }) => {
      if (!claimed && where.telegramLinkCode === "race-code") {
        claimed = true;
        return { count: 1 };
      }
      return { count: 0 };
    });

    await Promise.all([
      webhookPost(webhookReq(startUpdate("/start race-code", 1), SECRET)),
      webhookPost(webhookReq(startUpdate("/start race-code", 2), SECRET)),
    ]);

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(2);
    expect(successReplies()).toHaveLength(1);
  });

  it("links when the code is sent as a separate plain message", async () => {
    await webhookPost(webhookReq(startUpdate("a1eaef40", 880), SECRET));

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    const arg = mockUserUpdateMany.mock.calls[0][0];
    expect(arg.where.telegramLinkCode).toBe("a1eaef40");
    expect(arg.where.telegramLinkCodeExpiresAt).toEqual({ gt: expect.any(Date) });
    expect(arg.data.telegramChatId).toBe("880");
    expect(arg.data.telegramLinkCode).toBeNull();

    expect(mockSendChat).toHaveBeenCalledTimes(1);
    expect(mockSendChat).toHaveBeenCalledWith(
      880,
      "Akun DigiLib Anda berhasil dihubungkan dengan Telegram."
    );
  });

  it("normalizes an uppercase plain code before claiming it", async () => {
    await webhookPost(webhookReq(startUpdate("A1EAEF40", 881), SECRET));

    expect(mockUserUpdateMany.mock.calls[0][0].where.telegramLinkCode).toBe(
      "a1eaef40"
    );
    expect(successReplies()).toHaveLength(1);
  });

  it("does not treat arbitrary plain text as a code", async () => {
    for (const text of ["halo bot", "a1eaef4", "a1eaef40 tambahan", "bukan-kode"]) {
      await webhookPost(webhookReq(startUpdate(text, 882), SECRET));
    }

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockSendChat).not.toHaveBeenCalled();
  });

  it("reports an expired or already-used plain code as invalid", async () => {
    mockUserUpdateMany.mockResolvedValue({ count: 0 });

    await webhookPost(webhookReq(startUpdate("a1eaef40", 883), SECRET));

    expect(successReplies()).toHaveLength(0);
    expect(mockSendChat).toHaveBeenCalledWith(
      883,
      "Kode pengaitan tidak valid atau sudah kedaluwarsa."
    );
  });

  it("reports a database failure instead of claiming success", async () => {
    mockUserUpdateMany.mockRejectedValue(new Error("db down"));

    await webhookPost(webhookReq(startUpdate("a1eaef40", 884), SECRET));

    expect(successReplies()).toHaveLength(0);
    expect(mockSendChat).toHaveBeenCalledTimes(1);
    expect(mockSendChat).toHaveBeenCalledWith(
      884,
      "Penghubungan akun gagal. Silakan coba lagi."
    );
  });

  it("keeps the legacy /start <code> format working", async () => {
    await webhookPost(webhookReq(startUpdate("/start a1eaef40", 885), SECRET));

    expect(mockUserUpdateMany.mock.calls[0][0].where.telegramLinkCode).toBe(
      "a1eaef40"
    );
    expect(mockSendChat).toHaveBeenCalledWith(
      885,
      "Akun DigiLib Anda berhasil dihubungkan dengan Telegram."
    );
  });

  it("links an account through a Telegram deep-link payload", async () => {
    // Deep-link ?start=<kode> dikirim Telegram sebagai "/start <kode>".
    await webhookPost(webhookReq(startUpdate("/start  a1eaef40  ", 886), SECRET));

    const arg = mockUserUpdateMany.mock.calls[0][0];
    expect(arg.where.telegramLinkCode).toBe("a1eaef40");
    expect(arg.where.telegramLinkCodeExpiresAt).toEqual({ gt: expect.any(Date) });
    expect(arg.data.telegramChatId).toBe("886");
    expect(arg.data.telegramLinkCode).toBeNull();
    expect(arg.data.telegramLinkCodeExpiresAt).toBeNull();
    expect(mockSendChat).toHaveBeenCalledTimes(1);
    expect(mockSendChat).toHaveBeenCalledWith(
      886,
      "Akun DigiLib Anda berhasil dihubungkan dengan Telegram."
    );
  });

  it("reports an invalid /start code as an error, not a welcome message", async () => {
    mockUserUpdateMany.mockResolvedValue({ count: 0 });

    await webhookPost(webhookReq(startUpdate("/start kode-tidak-dikenal", 887), SECRET));

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUserUpdateMany.mock.calls[0][0].where.telegramLinkCode).toBe(
      "kode-tidak-dikenal"
    );
    expect(mockSendChat).toHaveBeenCalledTimes(1);
    expect(mockSendChat).toHaveBeenCalledWith(
      887,
      "Kode pengaitan tidak valid atau sudah kedaluwarsa."
    );
  });

  it("reports an expired /start code without linking", async () => {
    // Klaim atomik mensyaratkan telegramLinkCodeExpiresAt > sekarang.
    mockUserUpdateMany.mockResolvedValue({ count: 0 });

    await webhookPost(webhookReq(startUpdate("/start a1eaef40", 888), SECRET));

    const where = mockUserUpdateMany.mock.calls[0][0].where;
    expect(where).toEqual({
      telegramLinkCode: "a1eaef40",
      telegramLinkCodeExpiresAt: { gt: expect.any(Date) },
    });
    expect(successReplies()).toHaveLength(0);
    expect(mockSendChat).toHaveBeenCalledWith(
      888,
      "Kode pengaitan tidak valid atau sudah kedaluwarsa."
    );
  });

  it("supports linking again with a fresh code after unlinking", async () => {
    await webhookPost(webhookReq(startUpdate("/start a1eaef40", 889), SECRET));
    await webhookPost(webhookReq(startUpdate("/start", 889), SECRET));
    await webhookPost(webhookReq(startUpdate("/start b2bfbf50", 889), SECRET));

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(2);
    expect(
      mockUserUpdateMany.mock.calls.map(([arg]) => arg.where.telegramLinkCode)
    ).toEqual(["a1eaef40", "b2bfbf50"]);
    expect(successReplies()).toHaveLength(2);
    expect(mockSendChat).toHaveBeenCalledWith(889, START_WELCOME);
  });
});

describe("POST /api/telegram/link", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await linkPost(linkReq());
    expect(res.status).toBe(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects ADMIN and LIBRARIAN (non-borrowers)", async () => {
    for (const role of ["ADMIN", "LIBRARIAN"]) {
      mockGetServerSession.mockResolvedValue({ user: { id: "u1", role } });
      const res = await linkPost(linkReq());
      expect(res.status).toBe(403);
    }
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("creates a one-time, expiring code only for the session user", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-1", role: "STUDENT" } });

    const res = await linkPost(linkReq());
    expect(res.status).toBe(200);

    const arg = mockUserUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "stu-1" }); // hanya akun sendiri
    expect(typeof arg.data.telegramLinkCode).toBe("string");
    expect(arg.data.telegramLinkCode.length).toBeGreaterThan(0);
    expect(arg.data.telegramLinkCodeExpiresAt).toBeInstanceOf(Date);
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "allows a %s borrower to create a link code",
    async (role) => {
      mockGetServerSession.mockResolvedValue({ user: { id: "borrower-1", role } });

      const res = await linkPost(linkReq());
      expect(res.status).toBe(200);

      const arg = mockUserUpdate.mock.calls[0][0];
      expect(arg.where).toEqual({ id: "borrower-1" });
      expect(typeof arg.data.telegramLinkCode).toBe("string");
      expect(arg.data.telegramLinkCode.length).toBeGreaterThan(0);
      expect(arg.data.telegramLinkCodeExpiresAt).toBeInstanceOf(Date);
    }
  );
});

describe("DELETE /api/telegram/link – putuskan koneksi", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await unlinkDelete(unlinkReq());

    expect(res.status).toBe(401);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("clears only the Telegram fields of the session user", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-1", role: "STUDENT" } });

    const res = await unlinkDelete(unlinkReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.telegramLinked).toBe(false);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);

    const arg = mockUserUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "stu-1" });
    expect(arg.data).toEqual({
      telegramChatId: null,
      telegramLinkCode: null,
      telegramLinkCodeExpiresAt: null,
      telegramLinkedAt: null,
    });
  });

  it("ignores a userId supplied in the request", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-1", role: "STUDENT" } });

    const res = await unlinkDelete(unlinkReq("?userId=other-user"));

    expect(res.status).toBe(200);
    expect(mockUserUpdate.mock.calls[0][0].where).toEqual({ id: "stu-1" });
    expect(mockUserUpdate.mock.calls[0][0].where).not.toEqual({ id: "other-user" });
  });

  it("handles an account that is not linked yet", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-2", role: "STUDENT" } });
    mockUserFindUnique.mockResolvedValue({
      telegramChatId: null,
      telegramLinkCode: null,
    });

    const res = await unlinkDelete(unlinkReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.telegramLinked).toBe(false);
    expect(body.message).toContain("belum terhubung");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the session user no longer exists", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "gone", role: "STUDENT" } });
    mockUserFindUnique.mockResolvedValue(null);

    const res = await unlinkDelete(unlinkReq());

    expect(res.status).toBe(404);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("cancels a pending link code too", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-3", role: "STUDENT" } });
    mockUserFindUnique.mockResolvedValue({
      telegramChatId: null,
      telegramLinkCode: "pending-code",
    });

    const res = await unlinkDelete(unlinkReq());

    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "stu-3" },
      data: expect.objectContaining({ telegramLinkCode: null }),
    });
  });

  it("still allows generating a fresh link code afterwards", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-1", role: "STUDENT" } });

    await unlinkDelete(unlinkReq());
    const res = await linkPost(linkReq());

    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "stu-1" } })
    );
  });
});

describe("TELEGRAM_ENABLED=false", () => {
  it("disables the webhook", async () => {
    process.env.TELEGRAM_ENABLED = "false";

    await webhookPost(webhookReq(startUpdate("/start code-1", 9), SECRET));

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockSendChat).not.toHaveBeenCalled();
  });

  it("disables the link endpoint with 503", async () => {
    process.env.TELEGRAM_ENABLED = "false";
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-1", role: "STUDENT" } });

    const res = await linkPost(linkReq());
    expect(res.status).toBe(503);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
