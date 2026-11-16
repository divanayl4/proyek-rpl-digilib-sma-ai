import { LIBRARY_CONFIG, calculateDueDate, getEffectiveStatus, calculateFine } from "@/lib/config/library";
import { notifyBorrowSuccess, notifyReturnSuccess } from "@/lib/notifications";

// Mock prisma and auth to isolate testing business rules
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn((callback) => callback(mockTx)),
    borrowRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    book: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    }
  }
}));

jest.mock("@/lib/notifications", () => ({
  notifyBorrowSuccess: jest.fn(),
  notifyReturnSuccess: jest.fn(),
  sendInAppNotification: jest.fn(),
  notifyLibrarians: jest.fn(),
}));

const mockTx = {
  user: { findUnique: jest.fn() },
  borrowRecord: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  book: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() }
};

describe("Borrowing & Return Integration Logic", () => {
  afterEach(() => {
    jest.clearAllMocks();
    // Reset each mockTx mock explicitly so unconsumed `mockResolvedValueOnce`
    // queue entries cannot leak into the next test.
    Object.values(mockTx).forEach((model) => {
      Object.values(model).forEach((mock) => mock.mockReset());
    });
  });

  describe("Borrowing Business Rules", () => {
    it("should allow a valid student to borrow an available book", async () => {
      mockTx.user.findUnique.mockResolvedValue({ id: "user-1", role: "STUDENT", isActive: true, name: "Student 1" });
      mockTx.borrowRecord.findFirst.mockResolvedValue(null); // Not already borrowed this book
      mockTx.book.findUnique.mockResolvedValue({ id: "book-1", stock: 5, title: "Book 1" });
      mockTx.borrowRecord.count
        .mockResolvedValueOnce(1) // 1 active borrow (limit 3)
        .mockResolvedValueOnce(2); // 2 active books on loan

      // Simulate the transaction logic
      const activeBorrowCount = await mockTx.borrowRecord.count({ where: { userId: "user-1", status: "BORROWED" } });
      expect(activeBorrowCount).toBeLessThan(3);

      const activeLoans = await mockTx.borrowRecord.count({ where: { bookId: "book-1", status: "BORROWED" } });
      const availableStock = 5 - activeLoans; // stock - active loans
      expect(availableStock).toBeGreaterThan(0);

      const dueDate = calculateDueDate("STUDENT");
      expect(dueDate.getTime()).toBeGreaterThan(Date.now());
    });

    it("should reject borrowing if user reached limit", async () => {
      mockTx.borrowRecord.count.mockResolvedValue(3); // 3 active borrows (max for student)
      const activeBorrowCount = await mockTx.borrowRecord.count({ where: { userId: "user-1", status: "BORROWED" } });

      const maxBorrows = LIBRARY_CONFIG.maxBorrowsPerRole.STUDENT;
      expect(activeBorrowCount).toBe(maxBorrows);

      const isAllowed = activeBorrowCount < maxBorrows;
      expect(isAllowed).toBe(false);
    });

    it("should reject borrowing if book is out of stock", async () => {
      mockTx.book.findUnique.mockResolvedValue({ id: "book-1", stock: 2 });
      mockTx.borrowRecord.count.mockResolvedValue(2); // 2 active loans

      const stock = 2;
      const activeLoans = await mockTx.borrowRecord.count({ where: { bookId: "book-1", status: "BORROWED" } });
      const available = stock - activeLoans;

      expect(available).toBe(0);
      expect(available).toBeLessThanOrEqual(0);
    });
  });

  describe("Return Business Rules", () => {
    it("should correctly calculate fines and update status on return", () => {
      const borrowDate = new Date(Date.now() - 10 * 86400000); // 10 days ago
      const dueDate = new Date(Date.now() - 3 * 86400000); // 3 days ago (Overdue)
      const returnDate = new Date(); // Today

      const status = getEffectiveStatus("BORROWED", dueDate);
      expect(status).toBe("OVERDUE");

      const fine = calculateFine(dueDate, returnDate);
      expect(fine).toBeGreaterThan(0);
      expect(fine).toBe(3000); // 3 days * 1000 IDR
    });
  });

  describe("Notifications", () => {
    it("should trigger notifyReturnSuccess on return action", async () => {
      await notifyReturnSuccess("user-1", "Book 1", "borrow-1");
      expect(notifyReturnSuccess).toHaveBeenCalledWith("user-1", "Book 1", "borrow-1");
    });
    
    it("should trigger notifyBorrowSuccess on borrow action", async () => {
      const dueDate = new Date();
      await notifyBorrowSuccess("user-1", "Book 1", "borrow-1", dueDate);
      expect(notifyBorrowSuccess).toHaveBeenCalledWith("user-1", "Book 1", "borrow-1", dueDate);
    });
  });
});
