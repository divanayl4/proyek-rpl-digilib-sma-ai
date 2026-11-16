"use client";

import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { BookOpen, User, FileText, AlertCircle } from "lucide-react";

interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl?: string | null;
  category?: { name: string } | null;
  available: number;
  stock: number;
  format?: string;
  hasEbookFile?: boolean;
  grade?: string | null;
  subject?: string | null;
  major?: string | null;
}

export function BookCard({ book }: { book: Book }) {
  const isEbook = book.format === "EBOOK";
  const isReadable = isEbook && book.hasEbookFile;
  const isAvailable = !isEbook && book.available > 0;

  const dimensions = [book.grade ? `Kelas ${book.grade}` : null, book.subject, book.major]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link href={`/catalog/${book.id}`} className="group block h-full min-w-0">
      <article className="flex h-full min-w-0 flex-col bg-surface border border-border rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-border-purple">
        {/* Cover Area */}
        <div className="relative aspect-[2/3] w-full bg-bg-subtle overflow-hidden">
          {book.coverUrl ? (
            <Image
              src={book.coverUrl}
              alt={book.title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted bg-gradient-to-br" aria-hidden="true">
              <BookOpen size={44} className="opacity-30" />
              <span className="px-3 text-center text-[10px] font-semibold uppercase tracking-wide opacity-70">
                Belum ada sampul
              </span>
            </div>
          )}

          <div className="absolute left-2.5 right-2.5 top-2.5 flex flex-wrap items-start gap-1.5">
            {book.category && (
              <Badge variant="info" className="max-w-full truncate shadow-sm backdrop-blur-md bg-white/90">
                {book.category.name}
              </Badge>
            )}
            {isEbook && (
              <Badge variant="warning" className="shadow-sm backdrop-blur-md bg-white/90">
                <FileText size={12} className="mr-1" /> Ebook
              </Badge>
            )}
          </div>
        </div>

        {/* Info Area */}
        <div className="p-3 sm:p-4 flex flex-col flex-1">
          <h3 className="font-semibold text-main text-base sm:text-lg line-clamp-2 leading-tight group-hover:text-primary transition-colors">
            {book.title}
          </h3>

          <div className="flex items-center gap-1.5 mt-2 text-muted text-sm min-w-0">
            <User size={14} className="flex-shrink-0" />
            <span className="line-clamp-1">{book.author}</span>
          </div>

          {dimensions && (
            <p className="mt-2 text-xs text-muted line-clamp-2">{dimensions}</p>
          )}

          <div className="mt-auto pt-3 sm:pt-4 flex flex-wrap items-center justify-between gap-2">
            {isEbook ? (
              <>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-muted">Jenis</span>
                  <span className="text-sm font-medium text-main">Ebook Digital</span>
                </div>
                {isReadable ? (
                  <Badge variant="success">Siap Dibaca</Badge>
                ) : (
                  <Badge variant="warning">
                    <AlertCircle size={12} className="mr-1" /> Belum Ada PDF
                  </Badge>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-muted">Ketersediaan</span>
                  <span className={`text-sm font-medium ${isAvailable ? 'text-success' : 'text-danger'}`}>
                    {book.available} / {book.stock}
                  </span>
                </div>
                <Badge variant={isAvailable ? "success" : "danger"}>
                  {isAvailable ? "Tersedia" : "Dipinjam"}
                </Badge>
              </>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
