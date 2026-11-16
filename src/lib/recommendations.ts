/**
 * Rekomendasi buku untuk siswa.
 *
 * Rekomendasi selalu berasal dari katalog yang benar-benar ada di database —
 * tidak ada judul fiktif. Sinyal yang dipakai, dari yang paling kuat:
 *   1. Mata pelajaran yang pernah dipinjam siswa.
 *   2. Kategori buku yang pernah dipinjam.
 *   3. Tingkat kelas siswa (X/XI/XII) yang diturunkan dari kolom `class`.
 *
 * Bila siswa belum punya riwayat, rekomendasi jatuh ke koleksi terbaru agar
 * pengguna baru tetap mendapat saran yang masuk akal.
 *
 * Buku yang sedang aktif dipinjam oleh siswa selalu dikecualikan, dan riwayat
 * peminjaman pengguna lain tidak pernah dibaca.
 */

import { prisma } from "@/lib/prisma";

const ACTIVE_STATUSES = ["BORROWED", "OVERDUE"];

export interface Recommendation {
  id: string;
  title: string;
  author: string;
  format: string;
  subject: string | null;
  grade: string | null;
  categoryId: string | null;
}

/** Turunkan tingkat kelas dari string kelas, mis. "XII IPA 1" -> "XII". */
export function gradeFromClass(userClass: string | null | undefined): string | null {
  if (!userClass) return null;
  const match = userClass.trim().toUpperCase().match(/^(XII|XI|X)\b/);
  return match ? match[1] : null;
}

function scoreBook(
  book: { subject: string | null; categoryId: string | null; grade: string | null },
  signals: { subjects: Set<string>; categories: Set<string>; grade: string | null }
): number {
  let score = 0;
  if (book.subject && signals.subjects.has(book.subject)) score += 3;
  if (book.categoryId && signals.categories.has(book.categoryId)) score += 2;
  if (signals.grade && book.grade === signals.grade) score += 1;
  return score;
}

export async function getRecommendationsForUser(
  userId: string,
  limit = 3
): Promise<Recommendation[]> {
  const [user, history, active] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { class: true } }),
    prisma.borrowRecord.findMany({
      where: { userId },
      orderBy: { borrowDate: "desc" },
      take: 20,
      select: {
        book: { select: { subject: true, categoryId: true, grade: true } },
      },
    }),
    prisma.borrowRecord.findMany({
      where: { userId, status: { in: ACTIVE_STATUSES } },
      select: { bookId: true },
    }),
  ]);

  const excludeIds = new Set(active.map((a) => a.bookId));

  const subjects = new Set<string>();
  const categories = new Set<string>();
  for (const row of history) {
    if (row.book.subject) subjects.add(row.book.subject);
    if (row.book.categoryId) categories.add(row.book.categoryId);
  }
  const grade = gradeFromClass(user?.class);

  const signals = { subjects, categories, grade };
  const hasSignals = subjects.size > 0 || categories.size > 0 || grade !== null;

  const selected: Recommendation[] = [];
  const selectedIds = new Set<string>();

  if (hasSignals) {
    const orConditions: Record<string, unknown>[] = [];
    if (subjects.size > 0) orConditions.push({ subject: { in: Array.from(subjects) } });
    if (categories.size > 0) orConditions.push({ categoryId: { in: Array.from(categories) } });
    if (grade) orConditions.push({ grade });

    const candidates = await prisma.book.findMany({
      where: {
        archivedAt: null,
        OR: orConditions,
        ...(excludeIds.size > 0 ? { id: { notIn: Array.from(excludeIds) } } : {}),
      },
      take: 30,
      select: {
        id: true,
        title: true,
        author: true,
        format: true,
        subject: true,
        grade: true,
        categoryId: true,
      },
    });

    candidates
      .sort((a, b) => scoreBook(b, signals) - scoreBook(a, signals))
      .forEach((book) => {
        if (selected.length < limit && !selectedIds.has(book.id)) {
          selected.push(book);
          selectedIds.add(book.id);
        }
      });
  }

  // Lengkapi dari koleksi terbaru bila sinyal belum cukup.
  if (selected.length < limit) {
    const fallback = await prisma.book.findMany({
      where: {
        archivedAt: null,
        id: {
          notIn: Array.from(excludeIds).concat(Array.from(selectedIds)),
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit - selected.length,
      select: {
        id: true,
        title: true,
        author: true,
        format: true,
        subject: true,
        grade: true,
        categoryId: true,
      },
    });
    fallback.forEach((book) => {
      if (selected.length < limit && !selectedIds.has(book.id)) {
        selected.push(book);
        selectedIds.add(book.id);
      }
    });
  }

  return selected;
}
