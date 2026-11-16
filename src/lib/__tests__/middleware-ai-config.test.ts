/**
 * Middleware RBAC: halaman /admin/ai-config hanya untuk ADMIN, bukan sekadar
 * disembunyikan dari menu.
 */

jest.mock("next-auth/middleware", () => ({
  withAuth: (handler: unknown) => handler,
}));

import type { NextRequest } from "next/server";
import middleware from "@/middleware";

interface FakeRequest {
  url: string;
  nextUrl: { pathname: string };
  nextauth: { token: { role: string } | null };
}

type MiddlewareHandler = (
  req: NextRequest,
  event: unknown
) => Response | undefined | null | Promise<Response | undefined | null>;

const run = middleware as unknown as MiddlewareHandler;

function requestFor(pathname: string, role: string | null): NextRequest {
  const request: FakeRequest = {
    url: `http://localhost:3000${pathname}`,
    nextUrl: { pathname },
    nextauth: { token: role ? { role } : null },
  };
  return request as unknown as NextRequest;
}

async function redirectLocation(
  pathname: string,
  role: string | null
): Promise<string | null> {
  const result = await run(requestFor(pathname, role), {});
  expect(result).toBeInstanceOf(Response);
  return (result as Response).headers.get("location");
}

describe("middleware Konfigurasi AI", () => {
  it("mengizinkan ADMIN membuka /admin/ai-config", async () => {
    const result = await run(requestFor("/admin/ai-config", "ADMIN"), {});
    expect(result).toBeUndefined();
  });

  it.each(["LIBRARIAN", "TEACHER", "STUDENT", "STAFF"])(
    "mengalihkan %s dari /admin/ai-config ke /dashboard",
    async (role) => {
      expect(await redirectLocation("/admin/ai-config", role)).toBe(
        "http://localhost:3000/dashboard"
      );
    }
  );

  it("mengalihkan pengguna tanpa role ke /dashboard", async () => {
    expect(await redirectLocation("/admin/ai-config", null)).toBe(
      "http://localhost:3000/dashboard"
    );
  });
});
