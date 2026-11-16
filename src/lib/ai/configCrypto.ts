/**
 * Enkripsi API key konfigurasi AI (server-only).
 *
 * - AES-256-GCM (authenticated encryption) dengan IV acak 12 byte per enkripsi.
 * - Kunci diturunkan dari secret server: AI_CONFIG_ENCRYPTION_KEY bila tersedia,
 *   atau NEXTAUTH_SECRET sebagai fallback eksplisit. Kunci TIDAK pernah disimpan
 *   di database dan TIDAK dibuat ulang setiap proses.
 * - Ciphertext, IV, dan auth tag disimpan sebagai JSON pada tabel Setting.
 * - Bila kunci tidak tersedia/tidak valid, operasi enkripsi/dekripsi ditolak.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const AAD = Buffer.from("digilib-ai-config:v1", "utf8");
const KEY_SALT = "digilib-ai-config-key:v1";
const MIN_SECRET_LENGTH = 16;

const keyCache = new Map<string, Buffer>();

export interface EncryptionEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
}

export type EncryptionKeySource = "AI_CONFIG_ENCRYPTION_KEY" | "NEXTAUTH_SECRET";

export type EncryptionKeyState =
  | { available: true; source: EncryptionKeySource }
  | { available: false; reason: string };

function parseDedicatedKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (!value) return null;

  // Format hex 64 karakter (32 byte) diterima langsung.
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }

  // Format base64 32 byte.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    try {
      const decoded = Buffer.from(value, "base64");
      if (decoded.length === 32) return decoded;
    } catch {
      /* lanjut ke passphrase */
    }
  }

  // Passphrase panjang → KDF scrypt dengan salt tetap aplikasi.
  if (value.length >= MIN_SECRET_LENGTH) {
    return scryptSync(value, KEY_SALT, 32);
  }

  return null;
}

/**
 * Status kunci enkripsi. Tidak pernah mengembalikan nilai secret.
 */
export function getEncryptionKeyState(): EncryptionKeyState {
  const dedicated = process.env.AI_CONFIG_ENCRYPTION_KEY;
  if (dedicated !== undefined && dedicated.trim() !== "") {
    const parsed = parseDedicatedKey(dedicated);
    if (!parsed) {
      return {
        available: false,
        reason:
          "AI_CONFIG_ENCRYPTION_KEY tidak valid. Gunakan 64 karakter hex, base64 32 byte, atau passphrase minimal 16 karakter.",
      };
    }
    return { available: true, source: "AI_CONFIG_ENCRYPTION_KEY" };
  }

  const fallback = process.env.NEXTAUTH_SECRET;
  if (fallback && fallback.trim().length >= MIN_SECRET_LENGTH) {
    return { available: true, source: "NEXTAUTH_SECRET" };
  }

  return {
    available: false,
    reason:
      "Kunci enkripsi belum tersedia. Isi AI_CONFIG_ENCRYPTION_KEY (disarankan) atau NEXTAUTH_SECRET pada konfigurasi server.",
  };
}

function deriveKey(): { key: Buffer; source: EncryptionKeySource } | null {
  const state = getEncryptionKeyState();
  if (!state.available) return null;

  const raw =
    state.source === "AI_CONFIG_ENCRYPTION_KEY"
      ? (process.env.AI_CONFIG_ENCRYPTION_KEY as string)
      : (process.env.NEXTAUTH_SECRET as string);

  // Cache key memakai hash nilai secret; nilai mentah tidak disimpan sebagai key.
  const cacheKey = `${state.source}:${createHash("sha256")
    .update(raw)
    .digest("hex")}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key =
      state.source === "AI_CONFIG_ENCRYPTION_KEY"
        ? (parseDedicatedKey(raw) as Buffer)
        : scryptSync(raw, KEY_SALT, 32);
    keyCache.set(cacheKey, key);
  }
  return { key, source: state.source };
}

export class SecretEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretEncryptionError";
    Object.setPrototypeOf(this, SecretEncryptionError.prototype);
  }
}

/** Enkripsi API key. Melempar error aman bila kunci server tidak tersedia. */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.trim().length === 0) {
    throw new SecretEncryptionError("Nilai rahasia tidak boleh kosong.");
  }

  const derived = deriveKey();
  if (!derived) {
    const state = getEncryptionKeyState();
    throw new SecretEncryptionError(
      state.available ? "Kunci enkripsi tidak tersedia." : state.reason
    );
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derived.key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptionEnvelope = {
    v: 1,
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
  return JSON.stringify(envelope);
}

/**
 * Dekripsi envelope. Gagal (null) bila format rusak, kunci berubah, atau
 * autentikasi GCM tidak cocok. Tidak mencetak ciphertext/secret ke log.
 */
export function decryptSecret(envelopeJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    return null;
  }

  const envelope = parsed as Partial<EncryptionEnvelope> | null;
  if (
    !envelope ||
    envelope.v !== 1 ||
    envelope.alg !== ALGORITHM ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.data !== "string"
  ) {
    return null;
  }

  let iv: Buffer;
  let tag: Buffer;
  let data: Buffer;
  try {
    iv = Buffer.from(envelope.iv, "base64");
    tag = Buffer.from(envelope.tag, "base64");
    data = Buffer.from(envelope.data, "base64");
  } catch {
    return null;
  }
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH || data.length === 0) {
    return null;
  }

  const derived = deriveKey();
  if (!derived) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, derived.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/** Perbandingan waktu-konstan untuk kebutuhan pengujian/utilitas internal. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Untuk pengujian: bersihkan cache kunci ketika env berubah. */
export function resetEncryptionKeyCache(): void {
  keyCache.clear();
}
