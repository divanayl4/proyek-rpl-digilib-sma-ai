/**
 * Enkripsi API key konfigurasi AI — unit tests.
 * Tidak menggunakan API key asli.
 */

import {
  SecretEncryptionError,
  decryptSecret,
  encryptSecret,
  getEncryptionKeyState,
  resetEncryptionKeyCache,
} from "@/lib/ai/configCrypto";

const TEST_SECRET = "test-api-key-abcdef1234567890";
const originalEnv = {
  AI_CONFIG_ENCRYPTION_KEY: process.env.AI_CONFIG_ENCRYPTION_KEY,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
};

beforeEach(() => {
  process.env.AI_CONFIG_ENCRYPTION_KEY = "ab".repeat(32);
  delete process.env.NEXTAUTH_SECRET;
  resetEncryptionKeyCache();
});

afterAll(() => {
  if (originalEnv.AI_CONFIG_ENCRYPTION_KEY === undefined) {
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
  } else {
    process.env.AI_CONFIG_ENCRYPTION_KEY = originalEnv.AI_CONFIG_ENCRYPTION_KEY;
  }
  if (originalEnv.NEXTAUTH_SECRET === undefined) {
    delete process.env.NEXTAUTH_SECRET;
  } else {
    process.env.NEXTAUTH_SECRET = originalEnv.NEXTAUTH_SECRET;
  }
  resetEncryptionKeyCache();
});

describe("configCrypto", () => {
  it("mengenkripsi dan mendekripsi API key dengan AES-256-GCM", () => {
    const envelope = encryptSecret(TEST_SECRET);
    expect(envelope).not.toContain(TEST_SECRET);
    expect(JSON.parse(envelope)).toMatchObject({
      v: 1,
      alg: "aes-256-gcm",
    });
    expect(decryptSecret(envelope)).toBe(TEST_SECRET);
  });

  it("menghasilkan ciphertext berbeda untuk plaintext yang sama", () => {
    const first = encryptSecret(TEST_SECRET);
    const second = encryptSecret(TEST_SECRET);
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(TEST_SECRET);
    expect(decryptSecret(second)).toBe(TEST_SECRET);
  });

  it("menolak ciphertext yang dimodifikasi (auth tag tidak cocok)", () => {
    const parsed = JSON.parse(encryptSecret(TEST_SECRET)) as {
      data: string;
      [key: string]: unknown;
    };
    const bytes = Buffer.from(parsed.data, "base64");
    bytes[0] = bytes[0] ^ 0xff;
    parsed.data = bytes.toString("base64");
    expect(decryptSecret(JSON.stringify(parsed))).toBeNull();
  });

  it("menolak envelope dengan format rusak", () => {
    expect(decryptSecret("not-json")).toBeNull();
    expect(decryptSecret(JSON.stringify({ v: 2 }))).toBeNull();
    expect(decryptSecret(JSON.stringify({ v: 1, alg: "aes-256-gcm", iv: "", tag: "", data: "" }))).toBeNull();
  });

  it("menolak enkripsi bila kunci server tidak tersedia", () => {
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    delete process.env.NEXTAUTH_SECRET;
    resetEncryptionKeyCache();

    expect(getEncryptionKeyState().available).toBe(false);
    expect(() => encryptSecret(TEST_SECRET)).toThrow(SecretEncryptionError);
  });

  it("menolak kunci dedicated yang tidak valid tanpa diam-diam memakai fallback", () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = "terlalu-pendek";
    process.env.NEXTAUTH_SECRET = "fallback-secret-yang-cukup-panjang";
    resetEncryptionKeyCache();

    expect(getEncryptionKeyState()).toMatchObject({ available: false });
    expect(() => encryptSecret(TEST_SECRET)).toThrow(SecretEncryptionError);
  });

  it("memakai NEXTAUTH_SECRET hanya sebagai fallback eksplisit", () => {
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    process.env.NEXTAUTH_SECRET = "nextauth-secret-yang-cukup-panjang";
    resetEncryptionKeyCache();

    expect(getEncryptionKeyState()).toEqual({
      available: true,
      source: "NEXTAUTH_SECRET",
    });
    const envelope = encryptSecret(TEST_SECRET);
    expect(decryptSecret(envelope)).toBe(TEST_SECRET);
  });

  it("tidak dapat mendekripsi setelah kunci enkripsi berubah", () => {
    const envelope = encryptSecret(TEST_SECRET);
    process.env.AI_CONFIG_ENCRYPTION_KEY = "cd".repeat(32);
    resetEncryptionKeyCache();
    expect(decryptSecret(envelope)).toBeNull();
  });
});
