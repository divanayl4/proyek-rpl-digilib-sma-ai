import {
  EBOOK_CONFIG,
  EBOOK_ACCESS_STATE,
  MS_PER_DAY,
  calculateEbookExpiry,
  canBorrowEbook,
  canManageEbooks,
  EBOOK_OPERATOR_TOKEN_EXPIRES_AT,
  getEbookAccessState,
  isEbookAccessGranted,
  getRemainingMs,
  getRemainingParts,
  formatRemaining,
  signEbookReadToken,
  verifyEbookReadToken,
} from "@/lib/config/ebook";

const SECRET = "test-secret-value";
const NOW = new Date("2026-10-06T10:00:00.000Z");

describe("Ebook Config", () => {
  describe("EBOOK_CONFIG", () => {
    it("should default the access window to 5 days", () => {
      expect(EBOOK_CONFIG.accessDurationDays).toBe(5);
    });

    it("should bound how many ebooks one user may hold", () => {
      expect(EBOOK_CONFIG.maxActiveLoansPerUser).toBeGreaterThan(0);
    });

    it("should keep the read token lifetime short", () => {
      expect(EBOOK_CONFIG.readTokenTtlSeconds).toBeLessThanOrEqual(120);
    });

    it("should restrict borrowing to Siswa and Guru only", () => {
      expect([...EBOOK_CONFIG.borrowerRoles].sort()).toEqual(["STUDENT", "TEACHER"]);
    });
  });

  describe("canBorrowEbook", () => {
    it("should allow STUDENT and TEACHER", () => {
      expect(canBorrowEbook("STUDENT")).toBe(true);
      expect(canBorrowEbook("TEACHER")).toBe(true);
    });

    it("should refuse ADMIN, LIBRARIAN and STAFF", () => {
      expect(canBorrowEbook("ADMIN")).toBe(false);
      expect(canBorrowEbook("LIBRARIAN")).toBe(false);
      expect(canBorrowEbook("STAFF")).toBe(false);
    });

    it("should fail closed for missing or unknown roles", () => {
      expect(canBorrowEbook(null)).toBe(false);
      expect(canBorrowEbook(undefined)).toBe(false);
      expect(canBorrowEbook("")).toBe(false);
      expect(canBorrowEbook("student")).toBe(false);
    });
  });

  describe("canManageEbooks", () => {
    it("should allow ADMIN and LIBRARIAN (Lihat Buku path)", () => {
      expect(canManageEbooks("ADMIN")).toBe(true);
      expect(canManageEbooks("LIBRARIAN")).toBe(true);
    });

    it("should refuse STUDENT, TEACHER and STAFF", () => {
      expect(canManageEbooks("STUDENT")).toBe(false);
      expect(canManageEbooks("TEACHER")).toBe(false);
      expect(canManageEbooks("STAFF")).toBe(false);
    });

    it("should fail closed for missing or unknown roles", () => {
      expect(canManageEbooks(null)).toBe(false);
      expect(canManageEbooks(undefined)).toBe(false);
      expect(canManageEbooks("")).toBe(false);
      expect(canManageEbooks("admin")).toBe(false);
    });

    it("should use a sentinel epoch for operator tokens", () => {
      expect(EBOOK_OPERATOR_TOKEN_EXPIRES_AT.getTime()).toBe(0);
    });
  });

  describe("calculateEbookExpiry", () => {
    it("should add exactly 5 days to borrowedAt", () => {
      const expiresAt = calculateEbookExpiry(NOW);
      expect(expiresAt.getTime() - NOW.getTime()).toBe(5 * MS_PER_DAY);
    });

    it("should honour the default when borrowedAt is omitted", () => {
      const before = Date.now();
      const expiresAt = calculateEbookExpiry();
      const expected = before + 5 * MS_PER_DAY;
      // Allow a small window for the clock advancing during the call.
      expect(Math.abs(expiresAt.getTime() - expected)).toBeLessThan(2000);
    });

    it("should keep a fresh loan inside the window", () => {
      const expiresAt = calculateEbookExpiry(NOW);
      expect(getEbookAccessState({ borrowedAt: NOW, expiresAt }, NOW)).toBe(
        EBOOK_ACCESS_STATE.ACTIVE
      );
    });

    it("should lock the loan once the window has passed", () => {
      const borrowedAt = new Date(NOW.getTime() - 5 * MS_PER_DAY);
      const expiresAt = calculateEbookExpiry(borrowedAt);
      expect(getEbookAccessState({ borrowedAt, expiresAt }, NOW)).toBe(
        EBOOK_ACCESS_STATE.EXPIRED
      );
    });
  });

  describe("getEbookAccessState", () => {
    it("should return NOT_BORROWED when there is no loan", () => {
      expect(getEbookAccessState(null, NOW)).toBe(EBOOK_ACCESS_STATE.NOT_BORROWED);
      expect(getEbookAccessState(undefined, NOW)).toBe(EBOOK_ACCESS_STATE.NOT_BORROWED);
    });

    it("should return ACTIVE while expiresAt is in the future", () => {
      const loan = { borrowedAt: NOW, expiresAt: new Date(NOW.getTime() + MS_PER_DAY) };
      expect(getEbookAccessState(loan, NOW)).toBe(EBOOK_ACCESS_STATE.ACTIVE);
    });

    it("should return EXPIRED once expiresAt has passed", () => {
      const loan = {
        borrowedAt: new Date(NOW.getTime() - 6 * MS_PER_DAY),
        expiresAt: new Date(NOW.getTime() - MS_PER_DAY),
      };
      expect(getEbookAccessState(loan, NOW)).toBe(EBOOK_ACCESS_STATE.EXPIRED);
    });

    it("should derive EXPIRED from the timestamp even when status still says ACTIVE", () => {
      // The stored status column is only a cache – rewinding it must not
      // resurrect an expired loan.
      const loan = {
        borrowedAt: new Date(NOW.getTime() - 6 * MS_PER_DAY),
        expiresAt: new Date(NOW.getTime() - MS_PER_DAY),
        status: "ACTIVE",
      };
      expect(getEbookAccessState(loan, NOW)).toBe(EBOOK_ACCESS_STATE.EXPIRED);
    });

    it("should treat expiresAt as exclusive at the exact deadline", () => {
      const loan = { borrowedAt: NOW, expiresAt: NOW };
      expect(getEbookAccessState(loan, NOW)).toBe(EBOOK_ACCESS_STATE.EXPIRED);
    });

    it("should return RETURNED once returnedAt is set, regardless of expiry", () => {
      const loan = {
        borrowedAt: NOW,
        expiresAt: new Date(NOW.getTime() + MS_PER_DAY),
        returnedAt: NOW,
      };
      expect(getEbookAccessState(loan, NOW)).toBe(EBOOK_ACCESS_STATE.RETURNED);
    });

    it("should fail closed on an unparseable expiresAt", () => {
      const loan = { borrowedAt: NOW, expiresAt: new Date("not-a-date") };
      expect(getEbookAccessState(loan, NOW)).toBe(EBOOK_ACCESS_STATE.EXPIRED);
    });

    it("should accept string timestamps coming over the wire", () => {
      const loan = {
        borrowedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + MS_PER_DAY).toISOString(),
      };
      expect(getEbookAccessState(loan, NOW)).toBe(EBOOK_ACCESS_STATE.ACTIVE);
    });
  });

  describe("isEbookAccessGranted", () => {
    it("should only grant access for ACTIVE", () => {
      expect(isEbookAccessGranted(EBOOK_ACCESS_STATE.ACTIVE)).toBe(true);
      expect(isEbookAccessGranted(EBOOK_ACCESS_STATE.EXPIRED)).toBe(false);
      expect(isEbookAccessGranted(EBOOK_ACCESS_STATE.RETURNED)).toBe(false);
      expect(isEbookAccessGranted(EBOOK_ACCESS_STATE.NOT_BORROWED)).toBe(false);
    });
  });

  describe("getRemainingMs", () => {
    it("should return the remaining window", () => {
      const loan = { borrowedAt: NOW, expiresAt: new Date(NOW.getTime() + 2 * MS_PER_DAY) };
      expect(getRemainingMs(loan, NOW)).toBe(2 * MS_PER_DAY);
    });

    it("should clamp to zero instead of going negative", () => {
      const loan = {
        borrowedAt: new Date(NOW.getTime() - 6 * MS_PER_DAY),
        expiresAt: new Date(NOW.getTime() - MS_PER_DAY),
      };
      expect(getRemainingMs(loan, NOW)).toBe(0);
    });

    it("should return zero without a loan", () => {
      expect(getRemainingMs(null, NOW)).toBe(0);
    });
  });

  describe("getRemainingParts / formatRemaining", () => {
    it("should split days, hours, minutes and seconds", () => {
      const parts = getRemainingParts(
        2 * MS_PER_DAY + 3 * 3600000 + 4 * 60000 + 5000
      );
      expect(parts).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
    });

    it("should render days alongside the clock", () => {
      const formatted = formatRemaining(2 * MS_PER_DAY + 3 * 3600000 + 4 * 60000 + 5000);
      expect(formatted).toBe("2 Hari 03:04:05");
    });

    it("should render a bare clock under one day", () => {
      const formatted = formatRemaining(4 * 60000 + 11000);
      expect(formatted).toBe("00:04:11");
    });

    it("should never render negative time", () => {
      expect(getRemainingParts(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      expect(formatRemaining(-5000)).toBe("00:00:00");
    });
  });

  describe("read tokens", () => {
    const userId = "user-1";
    const bookId = "book-1";
    const expiresAt = new Date(NOW.getTime() + 3 * MS_PER_DAY);

    it("should accept a freshly signed token", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      expect(verifyEbookReadToken(token, userId, bookId, expiresAt, SECRET, NOW)).toBe(true);
    });

    it("should reject a token issued for a different user", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      expect(verifyEbookReadToken(token, "user-2", bookId, expiresAt, SECRET, NOW)).toBe(false);
    });

    it("should reject a token issued for a different ebook", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      expect(verifyEbookReadToken(token, userId, "book-2", expiresAt, SECRET, NOW)).toBe(false);
    });

    it("should reject a token once the loan's expiresAt is altered", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      const stretched = new Date(expiresAt.getTime() + 30 * MS_PER_DAY);
      expect(verifyEbookReadToken(token, userId, bookId, stretched, SECRET, NOW)).toBe(false);
    });

    it("should reject a token signed with a different secret", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      expect(verifyEbookReadToken(token, userId, bookId, expiresAt, "other-secret", NOW)).toBe(false);
    });

    it("should reject a token after its own short TTL elapses", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      const later = new Date(
        NOW.getTime() + (EBOOK_CONFIG.readTokenTtlSeconds + 1) * 1000
      );
      expect(verifyEbookReadToken(token, userId, bookId, expiresAt, SECRET, later)).toBe(false);
    });

    it("should reject a tampered signature", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      const [expiry, signature] = token.split(".");
      const flipped = signature.slice(0, -1) + (signature.endsWith("a") ? "b" : "a");
      expect(verifyEbookReadToken(`${expiry}.${flipped}`, userId, bookId, expiresAt, SECRET, NOW)).toBe(
        false
      );
    });

    it("should reject missing or malformed tokens", () => {
      expect(verifyEbookReadToken(null, userId, bookId, expiresAt, SECRET, NOW)).toBe(false);
      expect(verifyEbookReadToken("", userId, bookId, expiresAt, SECRET, NOW)).toBe(false);
      expect(verifyEbookReadToken("garbage", userId, bookId, expiresAt, SECRET, NOW)).toBe(false);
      expect(verifyEbookReadToken(".sig", userId, bookId, expiresAt, SECRET, NOW)).toBe(false);
      expect(verifyEbookReadToken("abc.", userId, bookId, expiresAt, SECRET, NOW)).toBe(false);
    });

    it("should reject everything when no secret is configured", () => {
      const token = signEbookReadToken(userId, bookId, expiresAt, SECRET, NOW);
      expect(verifyEbookReadToken(token, userId, bookId, expiresAt, "", NOW)).toBe(false);
    });
  });
});