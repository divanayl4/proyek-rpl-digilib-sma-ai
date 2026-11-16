import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { canUseAIAssistant } from "@/lib/ai/access";

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;
    const path = req.nextUrl.pathname;

    // Admin role protection
    if (path.startsWith("/admin") && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // Librarian role protection (Admin can also access)
    if (path.startsWith("/librarian") && role !== "LIBRARIAN" && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // Monitoring anggota & laporan analitik adalah administrasi — hanya ADMIN.
    // Dicek di server agar tidak dapat diakses lewat URL langsung.
    const adminOnlyLibrarianPath =
      path === "/librarian/members" ||
      path.startsWith("/librarian/members/") ||
      path === "/librarian/reports" ||
      path.startsWith("/librarian/reports/");
    if (adminOnlyLibrarianPath && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    // Student role protection
    if (path.startsWith("/student") && role !== "STUDENT" && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // Teacher role protection
    if (path.startsWith("/teacher") && role !== "TEACHER" && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // Staff role protection
    if (path.startsWith("/staff") && role !== "STAFF" && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // "Ebook Saya" hanya relevan untuk peminjam ebook (Siswa & Guru).
    // Admin/Pustakawan/Staf tidak memiliki peminjaman ebook, jadi diarahkan
    // ke katalog yang menyediakan aksi "Lihat Buku".
    if (path === "/ebooks/saya" || path.startsWith("/ebooks/saya/")) {
      const allowedMyEbooks =
        typeof role === "string" && (role === "STUDENT" || role === "TEACHER");
      if (!allowedMyEbooks) {
        return NextResponse.redirect(new URL("/ebooks", req.url));
      }
    }

    // AI Assistant tersedia untuk semua role (Siswa, Guru, Pustakawan, Admin)
    // dengan hak akses yang berbeda — lihat src/lib/ai/access.ts.
    if (path.startsWith("/assistant")) {
      const allowedAI = typeof role === "string" && canUseAIAssistant(role);
      if (!allowedAI) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/librarian/:path*",
    "/student/:path*",
    "/teacher/:path*",
    "/staff/:path*",
    "/notifications/:path*",
    "/notifications",
    "/assistant/:path*",
    "/assistant",
    "/ebooks/:path*",
    "/ebooks",
    "/profile",
  ],
};
