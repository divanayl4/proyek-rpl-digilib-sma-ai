/**
 * Unit tests for the centralized Telegram delivery module.
 *
 * Tidak ada panggilan nyata ke Telegram Bot API – global.fetch di-mock.
 */

const mockUserFindUnique = jest.fn();
const mockDeliveryCreate = jest.fn();
const mockDeliveryDeleteMany = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    telegramDelivery: {
      create: (...args: unknown[]) => mockDeliveryCreate(...args),
      deleteMany: (...args: unknown[]) => mockDeliveryDeleteMany(...args),
    },
  },
}));

import {
  deliverTelegramNotification,
  isTelegramEnabled,
  isTelegramRecipientRole,
} from "@/lib/telegram";

const fetchMock = jest.fn();

beforeAll(() => {
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "unit-test-token";
  process.env.TELEGRAM_ENABLED = "true";
  mockDeliveryCreate.mockResolvedValue({ id: "d1" });
  mockDeliveryDeleteMany.mockResolvedValue({ count: 1 });
  fetchMock.mockResolvedValue({ ok: true });
});

afterAll(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ENABLED;
});

describe("isTelegramRecipientRole", () => {
  it("only accepts the borrower roles TEACHER, STUDENT, and STAFF", () => {
    expect(isTelegramRecipientRole("TEACHER")).toBe(true);
    expect(isTelegramRecipientRole("STUDENT")).toBe(true);
    expect(isTelegramRecipientRole("STAFF")).toBe(true);
    expect(isTelegramRecipientRole("ADMIN")).toBe(false);
    expect(isTelegramRecipientRole("LIBRARIAN")).toBe(false);
    expect(isTelegramRecipientRole(null)).toBe(false);
  });
});

describe("isTelegramEnabled", () => {
  it("is disabled when the bot token is missing", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(isTelegramEnabled()).toBe(false);
  });

  it("can be turned off with TELEGRAM_ENABLED=false", () => {
    process.env.TELEGRAM_ENABLED = "false";
    expect(isTelegramEnabled()).toBe(false);
  });
});

describe("deliverTelegramNotification", () => {
  const input = { userId: "u1", title: "T", message: "M", eventKey: "k" };

  it("does nothing when disabled", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await deliverTelegramNotification(input);
    expect(res).toEqual({ sent: false, reason: "DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends to ADMIN/LIBRARIAN", async () => {
    for (const role of ["ADMIN", "LIBRARIAN"]) {
      mockUserFindUnique.mockResolvedValue({
        role,
        telegramChatId: "1",
        isActive: true,
      });
      const res = await deliverTelegramNotification({
        ...input,
        eventKey: `k-${role.toLowerCase()}`,
      });
      expect(res).toEqual({ sent: false, reason: "NOT_RECIPIENT" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends to a linked STAFF borrower", async () => {
    mockUserFindUnique.mockResolvedValue({
      role: "STAFF",
      telegramChatId: "333",
      isActive: true,
    });
    const res = await deliverTelegramNotification({
      ...input,
      eventKey: "k-staff",
    });
    expect(res).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).chat_id
    ).toBe("333");
  });

  it("skips recipients without a linked chat id", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "STUDENT", telegramChatId: null, isActive: true });
    const res = await deliverTelegramNotification({ ...input, eventKey: "k-nolink" });
    expect(res).toEqual({ sent: false, reason: "NOT_RECIPIENT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops private notifications after disconnect while other users still receive theirs", async () => {
    mockUserFindUnique
      .mockResolvedValueOnce({ role: "STUDENT", telegramChatId: null, isActive: true })
      .mockResolvedValueOnce({ role: "STUDENT", telegramChatId: "777", isActive: true });

    const disconnected = await deliverTelegramNotification({
      userId: "disconnected-user",
      title: "T",
      message: "M",
      eventKey: "after-disconnect",
    });

    expect(disconnected).toEqual({ sent: false, reason: "NOT_RECIPIENT" });
    expect(mockDeliveryCreate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const stillLinked = await deliverTelegramNotification({
      userId: "other-user",
      title: "T",
      message: "M",
      eventKey: "other-user-event",
    });

    expect(stillLinked).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).chat_id).toBe(
      "777"
    );
  });

  it("sends the exact title+message to a linked recipient", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "STUDENT", telegramChatId: "555", isActive: true });
    const res = await deliverTelegramNotification({
      userId: "u1",
      title: "Pengembalian Berhasil",
      message: 'Terima kasih telah mengembalikan buku "Buku A".',
      eventKey: "borrow:return:b1",
    });

    expect(res).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.telegram.org");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.chat_id).toBe("555");
    expect(body.text).toBe(
      'Pengembalian Berhasil\n\nTerima kasih telah mengembalikan buku "Buku A".'
    );
  });

  it("does not send twice for the same eventKey", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "TEACHER", telegramChatId: "1", isActive: true });
    mockDeliveryCreate.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), { code: "P2002" })
    );

    const res = await deliverTelegramNotification({ ...input, eventKey: "dup-1" });
    expect(res).toEqual({ sent: false, reason: "DUPLICATE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the claim and reports failure when the API rejects", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "STUDENT", telegramChatId: "9", isActive: true });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const res = await deliverTelegramNotification({ ...input, eventKey: "fail-1" });
    expect(res).toEqual({ sent: false, reason: "FAILED" });
    expect(mockDeliveryDeleteMany).toHaveBeenCalledWith({ where: { eventKey: "fail-1" } });
  });

  it("never throws even if the database fails", async () => {
    mockUserFindUnique.mockRejectedValue(new Error("db down"));
    const res = await deliverTelegramNotification({ ...input, eventKey: "boom" });
    expect(res).toEqual({ sent: false, reason: "FAILED" });
  });
});
