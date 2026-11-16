import { calculateDueDate, calculateFine, getEffectiveStatus, LIBRARY_CONFIG } from "@/lib/config/library";

describe("Library Config", () => {
  describe("LIBRARY_CONFIG", () => {
    it("should have maxBorrowsPerRole defined for all roles", () => {
      const roles = ["STUDENT", "TEACHER", "STAFF", "LIBRARIAN", "ADMIN"];
      roles.forEach((role) => {
        expect(LIBRARY_CONFIG.maxBorrowsPerRole[role]).toBeDefined();
        expect(LIBRARY_CONFIG.maxBorrowsPerRole[role]).toBeGreaterThan(0);
      });
    });

    it("should limit STUDENT to fewer borrows than TEACHER", () => {
      expect(LIBRARY_CONFIG.maxBorrowsPerRole.STUDENT).toBeLessThan(
        LIBRARY_CONFIG.maxBorrowsPerRole.TEACHER
      );
    });

    it("should only allow STUDENT, TEACHER, STAFF as borrowerRoles", () => {
      expect(LIBRARY_CONFIG.borrowerRoles).toContain("STUDENT");
      expect(LIBRARY_CONFIG.borrowerRoles).toContain("TEACHER");
      expect(LIBRARY_CONFIG.borrowerRoles).toContain("STAFF");
      expect(LIBRARY_CONFIG.borrowerRoles).not.toContain("ADMIN");
      expect(LIBRARY_CONFIG.borrowerRoles).not.toContain("LIBRARIAN");
    });
  });

  describe("calculateDueDate", () => {
    it("should return a date in the future", () => {
      const dueDate = calculateDueDate("STUDENT");
      expect(dueDate.getTime()).toBeGreaterThan(Date.now());
    });

    it("should give STUDENT shorter borrow period than TEACHER", () => {
      const base = new Date();
      const studentDue = calculateDueDate("STUDENT", base);
      const teacherDue = calculateDueDate("TEACHER", base);
      expect(studentDue.getTime()).toBeLessThan(teacherDue.getTime());
    });

    it("should respect custom borrowDate parameter", () => {
      const customDate = new Date("2024-01-01T00:00:00Z");
      const dueDate = calculateDueDate("STUDENT", customDate);
      const expectedDays = LIBRARY_CONFIG.borrowDurationDays["STUDENT"];
      const expectedDate = new Date(customDate);
      expectedDate.setDate(expectedDate.getDate() + expectedDays);
      expect(dueDate.toDateString()).toBe(expectedDate.toDateString());
    });

    it("should fallback to 7 days for unknown role", () => {
      const base = new Date("2024-01-01T00:00:00Z");
      const dueDate = calculateDueDate("UNKNOWN_ROLE", base);
      const expected = new Date(base);
      expected.setDate(expected.getDate() + 7);
      expect(dueDate.toDateString()).toBe(expected.toDateString());
    });
  });

  describe("calculateFine", () => {
    it("should return 0 when returned on time", () => {
      const dueDate = new Date("2024-01-10T00:00:00Z");
      const returnDate = new Date("2024-01-10T00:00:00Z");
      expect(calculateFine(dueDate, returnDate)).toBe(0);
    });

    it("should return 0 when returned before due date", () => {
      const dueDate = new Date("2024-01-10T00:00:00Z");
      const returnDate = new Date("2024-01-08T00:00:00Z");
      expect(calculateFine(dueDate, returnDate)).toBe(0);
    });

    it("should calculate fine for 1 day late", () => {
      const dueDate = new Date("2024-01-10T00:00:00Z");
      const returnDate = new Date("2024-01-11T00:00:00Z");
      expect(calculateFine(dueDate, returnDate)).toBe(LIBRARY_CONFIG.finePerDayIDR * 1);
    });

    it("should calculate fine for 5 days late", () => {
      const dueDate = new Date("2024-01-10T00:00:00Z");
      const returnDate = new Date("2024-01-15T00:00:00Z");
      expect(calculateFine(dueDate, returnDate)).toBe(LIBRARY_CONFIG.finePerDayIDR * 5);
    });
  });

  describe("getEffectiveStatus", () => {
    it("should return BORROWED for active non-overdue record", () => {
      const future = new Date(Date.now() + 86400000); // tomorrow
      expect(getEffectiveStatus("BORROWED", future)).toBe("BORROWED");
    });

    it("should return OVERDUE for BORROWED record past due date", () => {
      const past = new Date(Date.now() - 86400000); // yesterday
      expect(getEffectiveStatus("BORROWED", past)).toBe("OVERDUE");
    });

    it("should return RETURNED unchanged regardless of dueDate", () => {
      const past = new Date(Date.now() - 86400000);
      expect(getEffectiveStatus("RETURNED", past)).toBe("RETURNED");
    });

    it("should return CANCELLED unchanged", () => {
      const past = new Date(Date.now() - 86400000);
      expect(getEffectiveStatus("CANCELLED", past)).toBe("CANCELLED");
    });
  });
});
