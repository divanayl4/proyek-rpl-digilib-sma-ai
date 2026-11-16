"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import EbookCountdown from "./EbookCountdown";
import { BookOpen, FileText, RotateCcw, User } from "lucide-react";

export interface EbookListItem {
  id: string;
  title: string;
  author: string;
  coverUrl?: string | null;
  pageCount?: number | null;
  grade?: string | null;
  subject?: string | null;
  major?: string | null;
  accessState: "ACTIVE" | "EXPIRED" | "RETURNED" | "NOT_BORROWED";
  remainingMs: number;
  canBorrow: boolean;
  /** Server-verified manager read path (no loan required). */
  operator?: boolean;
  loan?: { id: string; borrowedAt: string; expiresAt: string } | null;
  category?: { id: string; name: string } | null;
}

interface EbookCardProps {
  ebook: EbookListItem;
  isBusy: boolean;
  maxActiveLoans: number;
  /**
   * Whether the signed-in viewer may borrow as an ordinary user (Siswa/Guru).
   * Admin/Pustakawan hanya melihat katalog tanpa aksi peminjaman.
   */
  canBorrowRole: boolean;
  /**
   * Whether the signed-in viewer is an ebook manager (Admin/Pustakawan). Such
   * viewers get a "Lihat Buku" action to read the PDF directly, without
   * borrowing and without creating a transaction.
   */
  canManage: boolean;
  onBorrow: (ebook: EbookListItem) => void;
  onReturn: (ebook: EbookListItem) => void;
  onOpenReader: (ebook: EbookListItem) => void;
}

/**
 * Status badge + action button follow one rule:
 *   ACTIVE        -> "Aktif"  + Baca
 *   EXPIRED       -> "Kedaluwarsa" + Kembalikan Ebook
 *                    (server menolak pinjam ulang selama loan lama belum
 *                    dikembalikan, jadi kartu harus menawarkan aksi yang valid)
 *   RETURNED      -> "Dikembalikan" + Pinjam Ebook (ketika kuota memungkinkan)
 *   NOT_BORROWED  -> "Belum Dipinjam" + Pinjam Ebook
 */
export function EbookStatusBadge({ accessState }: { accessState: EbookListItem["accessState"] }) {
  switch (accessState) {
    case "ACTIVE":
      return <Badge variant="success">Aktif</Badge>;
    case "EXPIRED":
      return <Badge variant="danger">Kedaluwarsa</Badge>;
    case "RETURNED":
      return <Badge variant="default">Dikembalikan</Badge>;
    default:
      return <Badge variant="info">Belum Dipinjam</Badge>;
  }
}

export function EbookCard({
  ebook,
  isBusy,
  maxActiveLoans,
  canBorrowRole,
  canManage,
  onBorrow,
  onReturn,
  onOpenReader,
}: EbookCardProps) {
  const isActive = ebook.accessState === "ACTIVE";
  const isExpired = ebook.accessState === "EXPIRED";
  // Managers read through the operator path; a historical/expired loan must
  // never make their catalog entry look locked.
  const isOperator = canManage || ebook.operator === true;

  const handleAction = () => {
    if (isActive) {
      onOpenReader(ebook);
    } else if (isExpired) {
      // A lapsed loan keeps the slot occupied until it is closed. Borrowing
      // again is refused by the server, so the only valid action is a return.
      onReturn(ebook);
    } else {
      onBorrow(ebook);
    }
  };

  const actionLabel = isActive
    ? "Baca"
    : isExpired
      ? "Kembalikan Ebook"
      : "Pinjam Ebook";

  const actionVariant = isActive ? "primary" : isExpired ? "secondary" : "primary";

  return (
    <div className="group flex flex-col h-full min-w-0 bg-surface border border-border rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-border-purple">
      <div className="relative aspect-[2/3] w-full bg-bg-subtle overflow-hidden">
        {ebook.coverUrl ? (
          <Image
            src={ebook.coverUrl}
            alt={ebook.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted gap-2 bg-gradient-to-br" aria-hidden="true">
            <FileText size={44} className="opacity-30" />
            <span className="px-3 text-center text-[10px] font-semibold uppercase tracking-wide opacity-70">
              Ebook
            </span>
          </div>
        )}

        <div className="absolute top-2.5 left-2.5 right-2.5 flex flex-wrap gap-1.5 items-start">
          {ebook.category && (
            <Badge variant="info" className="max-w-full truncate shadow-sm backdrop-blur-md bg-white/90">
              {ebook.category.name}
            </Badge>
          )}
          <Badge variant="default" className="shadow-sm backdrop-blur-md bg-white/90">
            PDF
          </Badge>
        </div>

        {/* Locked overlay once the window is over. Managers are never locked. */}
        {isExpired && !isOperator && (
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 text-white">
            <BookOpen size={32} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Terkunci
            </span>
          </div>
        )}
      </div>

      <div className="p-3 sm:p-4 flex flex-col flex-1 min-w-0">
        <h3 className="font-semibold text-main text-base sm:text-lg line-clamp-2 leading-tight">
          {ebook.title}
        </h3>

        <div className="flex items-center gap-1.5 mt-2 text-muted text-sm min-w-0">
          <User size={14} className="flex-shrink-0" />
          <span className="line-clamp-1">{ebook.author}</span>
        </div>

        {ebook.pageCount ? (
          <p className="text-xs text-muted mt-1">{ebook.pageCount} halaman</p>
        ) : null}

        {[ebook.grade ? `Kelas ${ebook.grade}` : null, ebook.subject, ebook.major].filter(Boolean).length > 0 && (
          <p className="text-xs text-muted mt-1 line-clamp-2">
            {[ebook.grade ? `Kelas ${ebook.grade}` : null, ebook.subject, ebook.major].filter(Boolean).join(" · ")}
          </p>
        )}

        <div className="mt-auto pt-3 sm:pt-4">
          {isOperator ? (
            <Button
              className="w-full"
              variant="primary"
              onClick={() => onOpenReader(ebook)}
              title="Lihat isi ebook tanpa meminjam"
            >
              <BookOpen size={16} /> Lihat Buku
            </Button>
          ) : canBorrowRole ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <EbookStatusBadge accessState={ebook.accessState} />
                {isActive && ebook.loan && (
                  <EbookCountdown expiresAt={ebook.loan.expiresAt} />
                )}
              </div>

              <Button
                className="w-full"
                variant={actionVariant}
                disabled={isBusy || (!isActive && !isExpired && !ebook.canBorrow)}
                onClick={handleAction}
                title={
                  isActive
                    ? "Baca ebook"
                    : isExpired
                      ? "Kembalikan ebook agar dapat meminjam lagi"
                      : "Pinjam ebook"
                }
              >
                {isActive ? (
                  <>
                    <BookOpen size={16} /> {actionLabel}
                  </>
                ) : isExpired ? (
                  <>
                    <RotateCcw size={16} /> {actionLabel}
                  </>
                ) : (
                  actionLabel
                )}
              </Button>

              {isExpired && (
                <p className="text-xs text-muted mt-2 text-center">
                  Masa akses habis. Kembalikan dulu untuk meminjam lagi.
                </p>
              )}

              {!isActive && !isExpired && !ebook.canBorrow && (
                <p className="text-xs text-muted mt-2 text-center">
                  Batas {maxActiveLoans} ebook aktif tercapai
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted text-center py-2">
              Peminjaman ebook hanya untuk Siswa dan Guru.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
