import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("bcryptjs", () => {
  const mockCompare = jest.fn();
  return {
    __esModule: true,
    default: {
      compare: mockCompare,
    },
    compare: mockCompare,
  };
});

describe("Auth Configuration & NextAuth Providers", () => {
  const credentialsProvider = authOptions.providers.find(
    (p) => p.id === "credentials" || p.name === "Credentials"
  ) as any;

  // In NextAuth v4, user-supplied authorize is kept on provider.options.authorize
  const authorize = credentialsProvider?.options?.authorize || credentialsProvider?.authorize;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("CredentialsProvider authorize", () => {
    it("should return null if credentials are empty or missing", async () => {
      expect(await authorize(null)).toBeNull();
      expect(await authorize({})).toBeNull();
      expect(await authorize({ email: "", password: "" })).toBeNull();
      expect(await authorize({ email: "test@example.com", password: "" })).toBeNull();
      expect(await authorize({ email: "", password: "password123" })).toBeNull();
    });

    it("should return null if user does not exist in database", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await authorize({
        email: "nonexistent@sekolah.sch.id",
        password: "password123",
      });

      expect(result).toBeNull();
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "nonexistent@sekolah.sch.id" },
      });
    });

    it("should normalize email by trimming and converting to lowercase", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await authorize({
        email: "  USER@Sekolah.SCH.ID  ",
        password: "secretpassword",
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "user@sekolah.sch.id" },
      });
    });

    it("should reject deactivated accounts (isActive = false)", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "u-inactive",
        email: "inactive@sekolah.sch.id",
        passwordHash: "hashed_pw",
        isActive: false,
        name: "Akun Nonaktif",
        role: "STUDENT",
      });

      const result = await authorize({
        email: "inactive@sekolah.sch.id",
        password: "password123",
      });

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it("should return null if password comparison fails", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "u-1",
        email: "user@sekolah.sch.id",
        passwordHash: "correct_hash",
        isActive: true,
        name: "Budi Siswa",
        role: "STUDENT",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await authorize({
        email: "user@sekolah.sch.id",
        password: "wrongpassword",
      });

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledWith("wrongpassword", "correct_hash");
    });

    it("should return sanitized user profile if credentials are valid", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "u-1",
        email: "budi@sekolah.sch.id",
        passwordHash: "valid_hash",
        isActive: true,
        name: "Budi Santoso",
        role: "STUDENT",
        identityNumber: "12345",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authorize({
        email: "budi@sekolah.sch.id",
        password: "correctpassword",
      });

      expect(result).toEqual({
        id: "u-1",
        email: "budi@sekolah.sch.id",
        name: "Budi Santoso",
        role: "STUDENT",
      });
      expect(result).not.toHaveProperty("passwordHash");
    });
  });

  describe("NextAuth Callbacks", () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    const sessionCallback = authOptions.callbacks?.session;

    it("jwt callback should attach user id and role to token", async () => {
      if (!jwtCallback) throw new Error("JWT callback missing");

      const token = { name: "Budi" };
      const user = { id: "u-10", role: "LIBRARIAN" } as any;

      const result = await jwtCallback({ token, user } as any);
      expect(result.id).toBe("u-10");
      expect(result.role).toBe("LIBRARIAN");
    });

    it("jwt callback should preserve existing token when user is undefined", async () => {
      if (!jwtCallback) throw new Error("JWT callback missing");

      const token = { id: "u-existing", role: "ADMIN" };
      const result = await jwtCallback({ token } as any);

      expect(result.id).toBe("u-existing");
      expect(result.role).toBe("ADMIN");
    });

    it("session callback should populate session.user from token", async () => {
      if (!sessionCallback) throw new Error("Session callback missing");

      const session = {
        user: { name: "Budi", email: "budi@sekolah.sch.id" },
        expires: "2026-12-31",
      };
      const token = { id: "u-10", role: "TEACHER" };

      const result: any = await sessionCallback({ session, token } as any);
      expect(result.user?.id).toBe("u-10");
      expect(result.user?.role).toBe("TEACHER");
    });

    it("session callback should handle session with no user gracefully", async () => {
      if (!sessionCallback) throw new Error("Session callback missing");

      const session = { expires: "2026-12-31" } as any;
      const token = { id: "u-10", role: "TEACHER" };

      const result = await sessionCallback({ session, token } as any);
      expect(result.user).toBeUndefined();
    });
  });

  describe("NextAuth Options configuration", () => {
    it("should configure jwt session strategy and login page", () => {
      expect(authOptions.session?.strategy).toBe("jwt");
      expect(authOptions.pages?.signIn).toBe("/login");
    });
  });
});
