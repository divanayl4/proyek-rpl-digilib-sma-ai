import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVELS } from "@/lib/config/smk";

export const dynamic = "force-dynamic";

/**
 * GET /api/books/filters
 *
 * Daftar opsi filter (kelas, mata pelajaran, jurusan) yang diambil langsung
 * dari data buku di database. Karena berasal dari data nyata, Admin/Pustakawan
 * bisa menambahkan jurusan atau mata pelajaran baru tanpa mengubah kode — nilainya
 * otomatis muncul di sini dan di UI.
 */
export async function GET() {
  try {
    const [gradeRows, subjectRows, majorRows, categories] = await Promise.all([
      prisma.book.findMany({
        where: { grade: { not: null }, archivedAt: null },
        select: { grade: true },
        distinct: ["grade"],
      }),
      prisma.book.findMany({
        where: { subject: { not: null }, archivedAt: null },
        select: { subject: true },
        distinct: ["subject"],
      }),
      prisma.book.findMany({
        where: { major: { not: null }, archivedAt: null },
        select: { major: true },
        distinct: ["major"],
      }),
      prisma.category.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    const gradeOrder = new Map<string, number>(
      GRADE_LEVELS.map((grade, index) => [grade, index])
    );

    const grades = gradeRows
      .map((row) => row.grade)
      .filter((value): value is string => Boolean(value))
      .sort(
        (a, b) =>
          (gradeOrder.get(a) ?? 99) - (gradeOrder.get(b) ?? 99) ||
          a.localeCompare(b, "id")
      );

    const subjects = subjectRows
      .map((row) => row.subject)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b, "id"));

    const majors = majorRows
      .map((row) => row.major)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b, "id"));

    return NextResponse.json({ grades, subjects, majors, categories });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch filters" }, { status: 500 });
  }
}