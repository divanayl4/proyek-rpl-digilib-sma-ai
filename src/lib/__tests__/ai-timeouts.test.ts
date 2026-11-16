/**
 * Batas waktu provider harus cukup untuk model lambat, tetapi tetap dibatasi.
 * Regresi: uji koneksi lama memakai 25 detik sehingga provider yang menjawab
 * ~50 detik selalu TIMEOUT dan aktivasi tidak pernah berhasil.
 */

const ORIGINAL_ENV = {
  AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
  AI_TOTAL_BUDGET_MS: process.env.AI_TOTAL_BUDGET_MS,
  AI_CONNECTION_TEST_TIMEOUT_MS: process.env.AI_CONNECTION_TEST_TIMEOUT_MS,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function loadTimeouts(env: Record<string, string | undefined>) {
  for (const key of Object.keys(ORIGINAL_ENV)) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  jest.resetModules();
  return import("@/lib/ai/timeouts");
}

afterAll(() => {
  restoreEnv();
  jest.resetModules();
});

describe("batas waktu provider AI", () => {
  it("default uji koneksi lebih longgar dari request biasa dan cukup untuk model lambat", async () => {
    const timeouts = await loadTimeouts({});
    expect(timeouts.AI_REQUEST_TIMEOUT_MS).toBe(75_000);
    expect(timeouts.AI_CONNECTION_TEST_TIMEOUT_MS).toBe(90_000);
    expect(timeouts.AI_TOTAL_BUDGET_MS).toBeGreaterThanOrEqual(
      timeouts.AI_REQUEST_TIMEOUT_MS + 15_000
    );
    expect(timeouts.AI_CONNECTION_TEST_TIMEOUT_MS).toBeGreaterThan(50_000);
  });

  it("membaca override environment", async () => {
    const timeouts = await loadTimeouts({
      AI_REQUEST_TIMEOUT_MS: "60000",
      AI_TOTAL_BUDGET_MS: "100000",
      AI_CONNECTION_TEST_TIMEOUT_MS: "80000",
    });
    expect(timeouts.AI_REQUEST_TIMEOUT_MS).toBe(60_000);
    expect(timeouts.AI_TOTAL_BUDGET_MS).toBe(100_000);
    expect(timeouts.AI_CONNECTION_TEST_TIMEOUT_MS).toBe(80_000);
  });

  it("meng-clamp nilai tidak wajar dan menjaga total >= request + 15 detik", async () => {
    const timeouts = await loadTimeouts({
      AI_REQUEST_TIMEOUT_MS: "1",
      AI_TOTAL_BUDGET_MS: "99999999",
      AI_CONNECTION_TEST_TIMEOUT_MS: "99999999",
    });
    expect(timeouts.AI_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(timeouts.AI_CONNECTION_TEST_TIMEOUT_MS).toBe(180_000);
    expect(timeouts.AI_TOTAL_BUDGET_MS).toBe(300_000);
  });

  it("mengabaikan nilai bukan angka", async () => {
    const timeouts = await loadTimeouts({
      AI_REQUEST_TIMEOUT_MS: "abc",
      AI_TOTAL_BUDGET_MS: "",
      AI_CONNECTION_TEST_TIMEOUT_MS: "x",
    });
    expect(timeouts.AI_REQUEST_TIMEOUT_MS).toBe(75_000);
    expect(timeouts.AI_TOTAL_BUDGET_MS).toBe(120_000);
    expect(timeouts.AI_CONNECTION_TEST_TIMEOUT_MS).toBe(90_000);
  });
});
