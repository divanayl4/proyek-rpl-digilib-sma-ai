/**
 * Unit tests for the SMK curriculum reference data and the book serialization
 * helpers. These lock the extensions contract: majors/subjects are plain text
 * data, and `filePath` must never leave the server.
 */

import { isValidGrade, GRADE_LEVELS, SMK_MAJORS, ALL_SUBJECTS, MAJOR_NAMES, MAJOR_CODES, MAJOR_FIELDS, findMajorByName, formatMajorLabel } from "@/lib/config/smk";
import {
  BOOK_FORMAT,
  isValidBookFormat,
  sanitizeEbookFilePath,
  cleanOptionalText,
  serializeBook,
  isReadableEbook,
} from "@/lib/books";

describe("SMK curriculum reference", () => {
  it("exposes the three grade levels", () => {
    expect(GRADE_LEVELS).toEqual(["X", "XI", "XII"]);
  });

  it("validates grades strictly", () => {
    expect(isValidGrade("X")).toBe(true);
    expect(isValidGrade("XI")).toBe(true);
    expect(isValidGrade("XII")).toBe(true);
    expect(isValidGrade("x")).toBe(false);
    expect(isValidGrade("XIII")).toBe(false);
    expect(isValidGrade("")).toBe(false);
  });

  it("ships a broad set of majors with unique codes and complete fields", () => {
    expect(SMK_MAJORS.length).toBeGreaterThanOrEqual(15);
    const codes = new Set(SMK_MAJORS.map((m) => m.code));
    expect(codes.size).toBe(SMK_MAJORS.length);
    for (const major of SMK_MAJORS) {
      expect(major.name.length).toBeGreaterThan(0);
      expect(major.field.length).toBeGreaterThan(0);
      expect(major.subjects.length).toBeGreaterThan(0);
    }
  });

  it("derives major name/code/field lists from the major table", () => {
    expect(MAJOR_NAMES).toHaveLength(SMK_MAJORS.length);
    expect(MAJOR_CODES).toHaveLength(SMK_MAJORS.length);
    expect(MAJOR_FIELDS.length).toBeGreaterThanOrEqual(4);
    expect(MAJOR_NAMES).toEqual([...MAJOR_NAMES].sort((a, b) => a.localeCompare(b, "id")));
  });

  it("collects a unique list of all subjects including general ones", () => {
    expect(ALL_SUBJECTS).toContain("Matematika");
    expect(ALL_SUBJECTS).toContain("Pemrograman Dasar");
    expect(new Set(ALL_SUBJECTS).size).toBe(ALL_SUBJECTS.length);
  });

  it("looks a major up by name or code, case-insensitively", () => {
    expect(findMajorByName("Rekayasa Perangkat Lunak")?.code).toBe("RPL");
    expect(findMajorByName("rpl")?.name).toBe("Rekayasa Perangkat Lunak");
    expect(findMajorByName("  perhotelan ")?.code).toBe("PERHOTELAN");
    expect(findMajorByName("Jurusan Tidak Ada")).toBeUndefined();
    expect(findMajorByName(null)).toBeUndefined();
  });

  it("formats a readable major label and falls back to the raw value", () => {
    expect(formatMajorLabel("RPL")).toBe("RPL – Rekayasa Perangkat Lunak");
    expect(formatMajorLabel("Jurusan Masa Depan")).toBe("Jurusan Masa Depan");
    expect(formatMajorLabel(null)).toBe("");
  });
});

describe("book format helpers", () => {
  it("accepts only known formats", () => {
    expect(isValidBookFormat(BOOK_FORMAT.EBOOK)).toBe(true);
    expect(isValidBookFormat(BOOK_FORMAT.PHYSICAL)).toBe(true);
    expect(isValidBookFormat("PDF")).toBe(false);
    expect(isValidBookFormat(undefined)).toBe(false);
  });

  it("keeps only a plain basename for ebook files", () => {
    expect(sanitizeEbookFilePath("ebook-123.pdf")).toBe("ebook-123.pdf");
    expect(sanitizeEbookFilePath("  spaced.pdf ")).toBe("spaced.pdf");
    expect(sanitizeEbookFilePath("nested/evil.pdf")).toBeNull();
    expect(sanitizeEbookFilePath("..\\..\\secret.pdf")).toBeNull();
    expect(sanitizeEbookFilePath("..")).toBeNull();
    expect(sanitizeEbookFilePath("bad\0name.pdf")).toBeNull();
    expect(sanitizeEbookFilePath("")).toBeNull();
    expect(sanitizeEbookFilePath(null)).toBeNull();
  });

  it("collapses blank optional text to null", () => {
    expect(cleanOptionalText("  Sains ")).toBe("Sains");
    expect(cleanOptionalText("   ")).toBeNull();
    expect(cleanOptionalText(null)).toBeNull();
    expect(cleanOptionalText(42)).toBeNull();
  });

  it("never leaks filePath and reports hasEbookFile instead", () => {
    const serialized = serializeBook({ id: "b1", title: "T", filePath: "secret.pdf", available: 2 });
    expect(serialized).not.toHaveProperty("filePath");
    expect(serialized.hasEbookFile).toBe(true);
    expect(serialized.available).toBe(2);

    const noFile = serializeBook({ id: "b2", title: "T2", filePath: null });
    expect(noFile.hasEbookFile).toBe(false);
  });

  it("treats only an ebook with a file as readable", () => {
    expect(isReadableEbook({ format: "EBOOK", filePath: "a.pdf" })).toBe(true);
    expect(isReadableEbook({ format: "EBOOK", filePath: null })).toBe(false);
    expect(isReadableEbook({ format: "PHYSICAL", filePath: "a.pdf" })).toBe(false);
  });
});