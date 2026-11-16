import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, Sparkles, Search } from "lucide-react";
import { getRecommendationsForUser } from "@/lib/recommendations";

export const dynamic = "force-dynamic";

export default async function TeacherRecommendationsPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <DashboardLayout>
        <p className="text-muted">Silakan masuk terlebih dahulu.</p>
      </DashboardLayout>
    );
  }

  const recommendations = await getRecommendationsForUser(userId, 9);

  return (
    <DashboardLayout>
      <div className="page-header mb-6">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <Sparkles size={24} className="text-primary flex-shrink-0" aria-hidden="true" /> Rekomendasi Referensi
          </h1>
          <p className="page-description">
            Saran buku dari katalog berdasarkan riwayat dan kebutuhan mengajar Anda.
          </p>
        </div>
        <div className="page-actions">
          <Link href="/catalog">
            <Button variant="secondary">
              <Search size={16} /> Jelajahi Katalog
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Untuk Anda</CardTitle>
          <CardDescription>Saran berasal dari koleksi yang benar-benar tersedia di perpustakaan.</CardDescription>
        </CardHeader>
        <CardBody>
          {recommendations.length === 0 ? (
            <EmptyState
              title="Belum ada rekomendasi"
              description="Katalog buku masih kosong atau belum ada koleksi yang cocok."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recommendations.map((book) => (
                <Link
                  key={book.id}
                  href={`/catalog/${book.id}`}
                  className="flex flex-col gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-16 rounded-md bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <BookOpen size={20} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-main line-clamp-2">{book.title}</h3>
                      <p className="text-xs text-muted line-clamp-1 mt-1">{book.author}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
                    {book.subject && <Badge variant="info">{book.subject}</Badge>}
                    {book.grade && <Badge>Kelas {book.grade}</Badge>}
                    {book.format === "EBOOK" && <Badge variant="warning">Ebook</Badge>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </DashboardLayout>
  );
}
