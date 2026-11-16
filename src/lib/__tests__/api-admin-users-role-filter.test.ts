/**
 * Role access & filter tests for GET /api/admin/users.
 *
 * User administration (including the user list) is ADMIN-only. Librarians must
 * not be able to list accounts, even with a crafted role filter.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

const mockFindMany = jest.fn();
const mockCount = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
  },
}));

import { GET as getUsers } from "@/app/api/admin/users/route";

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", role } });
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/admin/users${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("GET /api/admin/users – role access", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getUsers(request());
    expect(res.status).toBe(401);
  });

  it.each(["LIBRARIAN", "STUDENT", "TEACHER", "STAFF"])(
    "rejects %s (ADMIN-only user administration)",
    async (role) => {
      signInAs(role);
      const res = await getUsers(request());
      expect(res.status).toBe(403);
      expect(mockFindMany).not.toHaveBeenCalled();
    }
  );

  it("lets an admin filter by any role", async () => {
    signInAs("ADMIN");
    await getUsers(request("?role=ADMIN"));

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.role).toBe("ADMIN");
  });

  it("honours a multi-role filter for an admin", async () => {
    signInAs("ADMIN");
    await getUsers(request("?role=STUDENT,TEACHER"));

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ in: ["STUDENT", "TEACHER"] });
  });

  it("does not constrain an unfiltered admin query", async () => {
    signInAs("ADMIN");
    await getUsers(request());

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.role).toBeUndefined();
  });

  it("ignores an invalid role value for an admin", async () => {
    signInAs("ADMIN");
    await getUsers(request("?role=HACKER"));

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.role).toBeUndefined();
  });

  it("scopes the count query with the same filter as the list query", async () => {
    signInAs("ADMIN");
    await getUsers(request("?role=STUDENT"));

    expect(mockCount.mock.calls[0][0].where.role).toBe("STUDENT");
  });
});
