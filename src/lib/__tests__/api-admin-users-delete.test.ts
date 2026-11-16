/**
 * DELETE /api/admin/users/[id] — kebijakan penghapusan pengguna.
 *
 * Tujuan: memastikan penghapusan akun TIDAK menghapus riwayat transaksi.
 * Akun yang punya pinjaman/ebook/denda/audit log dinonaktifkan (soft delete),
 * sedangkan akun bersih benar-benar dihapus dan dicatat.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserDelete = jest.fn();
const mockUserUpdate = jest.fn();
const mockNotificationDeleteMany = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      delete: (...args: unknown[]) => mockUserDelete(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    notification: {
      deleteMany: (...args: unknown[]) => mockNotificationDeleteMany(...args),
    },
    ebookReadingSession: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ebookLoan: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    borrowRecord: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finePayment: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: (...args: unknown[]) => mockAuditCreate(...args),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

import { DELETE } from "@/app/api/admin/users/[id]/route";

function signInAs(role: string, id = "admin-1") {
  mockGetServerSession.mockResolvedValue({ user: { id, role } });
}

function request(id: string) {
  return new NextRequest(`http://localhost:3000/api/admin/users/${id}`, { method: "DELETE" });
}

function targetWith(counts: Partial<Record<"borrows" | "ebookLoans" | "finePayments" | "auditLogs", number>>) {
  return {
    id: "u-target",
    email: "target@sma.id",
    role: "STUDENT",
    _count: {
      borrows: 0,
      ebookLoans: 0,
      finePayments: 0,
      auditLogs: 0,
      ...counts,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  signInAs("ADMIN");
  mockUserFindUnique.mockResolvedValue(targetWith({}));
  mockUserDelete.mockResolvedValue({});
  mockUserUpdate.mockResolvedValue({});
  mockNotificationDeleteMany.mockResolvedValue({ count: 0 });
  mockAuditCreate.mockResolvedValue({});
});

describe("DELETE /api/admin/users/[id]", () => {
  it("menolak non-admin", async () => {
    signInAs("LIBRARIAN");
    const res = await DELETE(request("u-target"), { params: { id: "u-target" } });
    expect(res.status).toBe(403);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("menolak menghapus akun sendiri", async () => {
    const res = await DELETE(request("admin-1"), { params: { id: "admin-1" } });
    expect(res.status).toBe(400);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("menghapus permanen akun yang punya riwayat peminjaman (hard delete)", async () => {
    mockUserFindUnique.mockResolvedValue(targetWith({ borrows: 2 }));

    const res = await DELETE(request("u-target"), { params: { id: "u-target" } });

    expect(res.status).toBe(200);
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "u-target" } });
  });

  it("menghapus permanen akun yang punya ebook/denda/audit log (hard delete)", async () => {
    for (const counts of [{ ebookLoans: 1 }, { finePayments: 1 }, { auditLogs: 3 }]) {
      jest.clearAllMocks();
      signInAs("ADMIN");
      mockUserFindUnique.mockResolvedValue(targetWith(counts));
      mockUserDelete.mockResolvedValue({});

      const res = await DELETE(request("u-target"), { params: { id: "u-target" } });

      expect(res.status).toBe(200);
      expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "u-target" } });
    }
  });

  it("menghapus akun bersih dan mencatat audit DELETE_USER", async () => {
    const res = await DELETE(request("u-target"), { params: { id: "u-target" } });

    expect(res.status).toBe(200);
    expect(mockNotificationDeleteMany).toHaveBeenCalledWith({ where: { userId: "u-target" } });
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "u-target" } });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "USER_DELETED", userId: "admin-1" }),
      })
    );
  });

  it("mengembalikan 404 untuk pengguna yang tidak ada", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await DELETE(request("ghost"), { params: { id: "ghost" } });
    expect(res.status).toBe(404);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
});
