/**
 * Unit tests for the centralized borrowing/fine business rules.
 * These lock in the fine snapshot math so a later refactor cannot silently
 * change how much a student is charged.
 */

import {
  BORROW_STATUS,
  ACTIVE_BORROW_STATUSES,
  OPEN_BORROW_STATUSES,
  calculateDueDate,
  calculateLateDays,
  calculateFineBreakdown,
  calculateFine,
  getReturnTimeliness,
} from "@/lib/config/library";

const DAY = 1000 * 60 * 60 * 24;

describe("borrow status constants", () => {
  it("only BORROWED/OVERDUE hold physical stock", () => {
    expect(ACTIVE_BORROW_STATUSES).toEqual([BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE]);
    expect(ACTIVE_BORROW_STATUSES).not.toContain(BORROW_STATUS.REQUESTED);
  });

  it("REQUESTED is open (holds quota) but not active (does not hold stock)", () => {
    expect(OPEN_BORROW_STATUSES).toContain(BORROW_STATUS.REQUESTED);
    expect(ACTIVE_BORROW_STATUSES).not.toContain(BORROW_STATUS.REQUESTED);
  });
});

describe("calculateDueDate", () => {
  it("uses the per-role duration from the borrow date", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const due = calculateDueDate("STUDENT", from);
    expect(Math.round((due.getTime() - from.getTime()) / DAY)).toBe(7);
  });

  it("gives teachers a longer window than students", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(calculateDueDate("TEACHER", from).getTime()).toBeGreaterThan(
      calculateDueDate("STUDENT", from).getTime()
    );
  });
});

describe("calculateLateDays", () => {
  it("returns 0 when returned before or exactly on the due date", () => {
    const due = new Date("2026-01-10T10:00:00Z");
    expect(calculateLateDays(due, new Date("2026-01-05T10:00:00Z"))).toBe(0);
    expect(calculateLateDays(due, due)).toBe(0);
  });

  it("rounds partial days up", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    const late = new Date(due.getTime() + DAY + 60_000); // 1 day + 1 minute
    expect(calculateLateDays(due, late)).toBe(2);
  });
});

describe("calculateFine", () => {
  it("multiplies late days by the supplied rate", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    const ret = new Date(due.getTime() + 3 * DAY);
    expect(calculateFine(due, ret, 1000)).toBe(3000);
  });

  it("is zero when not late regardless of rate", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    expect(calculateFine(due, new Date("2026-01-09T00:00:00Z"), 5000)).toBe(0);
  });

  it("exposes a transparent breakdown", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    const ret = new Date(due.getTime() + 2 * DAY);
    expect(calculateFineBreakdown(due, ret, 750)).toEqual({
      daysLate: 2,
      ratePerDay: 750,
      amount: 1500,
    });
  });
});

describe("getReturnTimeliness", () => {
  // F.5 – tepat pada tanggal/tenggat = tepat waktu.
  it("is ONTIME when returned before or exactly on the due timestamp", () => {
    const due = new Date("2026-10-18T07:00:00Z");
    expect(getReturnTimeliness(due, new Date("2026-10-17T07:00:00Z"))).toBe("ONTIME");
    expect(getReturnTimeliness(due, due)).toBe("ONTIME");
    expect(getReturnTimeliness(due, new Date(due.getTime() - 1))).toBe("ONTIME");
  });

  it("is LATE one millisecond after the due timestamp", () => {
    const due = new Date("2026-10-18T07:00:00Z");
    expect(getReturnTimeliness(due, new Date(due.getTime() + 1))).toBe("LATE");
  });

  // F.6 – tanggal tenggat tidak tersedia/tidak valid → JANGAN menebak.
  it("is UNKNOWN when the due date is missing or invalid", () => {
    expect(getReturnTimeliness(null, new Date())).toBe("UNKNOWN");
    expect(getReturnTimeliness(undefined, new Date())).toBe("UNKNOWN");
    expect(getReturnTimeliness(new Date("nope"), new Date())).toBe("UNKNOWN");
  });

  // F.7 – tanggal pengembalian tidak tersedia/tidak valid → JANGAN menebak.
  it("is UNKNOWN when the return date is missing or invalid", () => {
    expect(getReturnTimeliness(new Date(), null)).toBe("UNKNOWN");
    expect(getReturnTimeliness(new Date(), undefined)).toBe("UNKNOWN");
    expect(getReturnTimeliness(new Date(), new Date("nope"))).toBe("UNKNOWN");
  });

  // F.8 – klasifikasi per instan; label timezone tidak menggeser hasil.
  it("classifies by instant regardless of the timezone representation (WIB vs UTC)", () => {
    const due = new Date("2026-10-18T14:00:00+07:00"); // 14:00 WIB
    const sameInstant = new Date("2026-10-18T07:00:00Z");
    const splitSecondBeforeWib = new Date("2026-10-18T13:59:59+07:00");
    const oneSecondAfterWib = new Date("2026-10-18T14:00:01+07:00");

    expect(due.getTime()).toBe(sameInstant.getTime());
    expect(getReturnTimeliness(due, splitSecondBeforeWib)).toBe("ONTIME");
    expect(getReturnTimeliness(due, sameInstant)).toBe("ONTIME");
    expect(getReturnTimeliness(due, oneSecondAfterWib)).toBe("LATE");
  });
});
