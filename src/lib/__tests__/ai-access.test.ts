/**
 * AI Chat — Kendali akses role.
 *
 * Memastikan AI Assistant tersedia untuk Siswa, Guru, Pustakawan, Admin
 * (bukan Staf), dan kategori tool dibatasi per role.
 */

import {
  AI_ASSISTANT_ROLES,
  canUseAIAssistant,
  canUseToolCategory,
  roleLabel,
} from "@/lib/ai/access";

describe("canUseAIAssistant()", () => {
  it("mengizinkan Siswa, Guru, Pustakawan, dan Admin", () => {
    expect(AI_ASSISTANT_ROLES).toEqual(
      expect.arrayContaining(["STUDENT", "TEACHER", "LIBRARIAN", "ADMIN"])
    );
    for (const role of ["STUDENT", "TEACHER", "LIBRARIAN", "ADMIN"]) {
      expect(canUseAIAssistant(role)).toBe(true);
    }
  });

  it("menolak role tidak dikenal", () => {
    expect(canUseAIAssistant("SUPERUSER")).toBe(false);
    expect(canUseAIAssistant(null)).toBe(false);
    expect(canUseAIAssistant(undefined)).toBe(false);
  });

  it("mengizinkan Staf untuk asisten AI", () => {
    expect(canUseAIAssistant("STAFF")).toBe(true);
  });
});

describe("canUseToolCategory()", () => {
  it("semua role AI boleh memakai tool PERSONAL", () => {
    for (const role of ["STUDENT", "TEACHER", "LIBRARIAN", "ADMIN"]) {
      expect(canUseToolCategory(role, "PERSONAL")).toBe(true);
    }
  });

  it("hanya Pustakawan dan Admin yang boleh memakai OPERATIONAL", () => {
    expect(canUseToolCategory("LIBRARIAN", "OPERATIONAL")).toBe(true);
    expect(canUseToolCategory("ADMIN", "OPERATIONAL")).toBe(true);
    expect(canUseToolCategory("STUDENT", "OPERATIONAL")).toBe(false);
    expect(canUseToolCategory("TEACHER", "OPERATIONAL")).toBe(false);
    expect(canUseToolCategory("STAFF", "OPERATIONAL")).toBe(false);
  });

  it("hanya Admin yang boleh memakai ADMINISTRATIVE", () => {
    expect(canUseToolCategory("ADMIN", "ADMINISTRATIVE")).toBe(true);
    expect(canUseToolCategory("LIBRARIAN", "ADMINISTRATIVE")).toBe(false);
    expect(canUseToolCategory("STUDENT", "ADMINISTRATIVE")).toBe(false);
    expect(canUseToolCategory("TEACHER", "ADMINISTRATIVE")).toBe(false);
  });
});

describe("roleLabel()", () => {
  it("memberi label ramah untuk setiap role", () => {
    expect(roleLabel("STUDENT")).toBe("Siswa");
    expect(roleLabel("TEACHER")).toBe("Guru");
    expect(roleLabel("LIBRARIAN")).toBe("Pustakawan");
    expect(roleLabel("ADMIN")).toBe("Administrator");
  });
});
