/**
 * Permission tests for the fine-tariff settings endpoint.
 *
 * GET and PATCH (fine tariff) are allowed for Admin and Pustakawan: librarians
 * manage fines, including the official rate. Other roles are forbidden.
 */

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { create: jest.fn() } },
}));

jest.mock("@/lib/config/settings", () => ({
  getFinePerDayIDR: jest.fn(async () => 1000),
  isFineRateConfigured: jest.fn(async () => true),
  setFinePerDayIDR: jest.fn(async () => undefined),
  setDamageFineIDR: jest.fn(async () => undefined),
  getDamageFineConfig: jest.fn(async () => [
    { key: "GOOD", label: "Baik", amountIDR: 0, configured: true, defaultIDR: 0 },
    { key: "TORN_PAGE", label: "Halaman rusak", amountIDR: 5000, configured: false, defaultIDR: 5000 },
  ]),
}));

import { setFinePerDayIDR, setDamageFineIDR } from "@/lib/config/settings";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/admin/settings/route";

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", role } });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost:3000/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/admin/settings", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getSettings();
    expect(res.status).toBe(401);
  });

  it.each(["ADMIN", "LIBRARIAN"])("allows %s to read the tariff", async (role) => {
    signInAs(role);
    const res = await getSettings();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.finePerDayIDR).toBe(1000);
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "forbids %s from reading the tariff",
    async (role) => {
      signInAs(role);
      const res = await getSettings();
      expect(res.status).toBe(403);
    }
  );
});

describe("PATCH /api/admin/settings", () => {
  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "forbids %s from changing the tariff",
    async (role) => {
      signInAs(role);
      const res = await patchSettings(patchRequest({ finePerDayIDR: 2000 }));
      expect(res.status).toBe(403);
      expect(setFinePerDayIDR).not.toHaveBeenCalled();
    }
  );

  it.each(["ADMIN", "LIBRARIAN"])("lets %s change the tariff", async (role) => {
    signInAs(role);
    const res = await patchSettings(patchRequest({ finePerDayIDR: 2000 }));
    expect(res.status).toBe(200);
    expect(setFinePerDayIDR).toHaveBeenCalledWith(2000);
  });

  it("lets an ADMIN change damage-condition tariffs as an object map", async () => {
    signInAs("ADMIN");
    const res = await patchSettings(
      patchRequest({ damageConditions: { TORN_PAGE: 7500, GOOD: 0 } })
    );
    expect(res.status).toBe(200);
    expect(setDamageFineIDR).toHaveBeenCalledWith("TORN_PAGE", 7500);
    expect(setDamageFineIDR).toHaveBeenCalledWith("GOOD", 0);
  });

  it("rejects an unknown damage category", async () => {
    signInAs("ADMIN");
    const res = await patchSettings(
      patchRequest({ damageConditions: { NOT_A_CONDITION: 5000 } })
    );
    expect(res.status).toBe(400);
    expect(setDamageFineIDR).not.toHaveBeenCalled();
  });

  it("rejects a negative damage tariff", async () => {
    signInAs("ADMIN");
    const res = await patchSettings(
      patchRequest({ damageConditions: { TORN_PAGE: -1 } })
    );
    expect(res.status).toBe(400);
    expect(setDamageFineIDR).not.toHaveBeenCalled();
  });
});
