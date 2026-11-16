import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import MyEbooksPage from "@/components/ebooks/MyEbooksPage";
import { authOptions } from "@/lib/auth";

export const metadata = {
  title: "Ebook Saya - DigiLib",
};

export default async function MyEbooksRoute() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;

  // Halaman ini hanya untuk peminjam ebook (Siswa & Guru). Admin/Pustakawan/Staf
  // diarahkan ke katalog ebook yang menyediakan aksi "Lihat Buku".
  if (role !== "STUDENT" && role !== "TEACHER") {
    redirect("/ebooks");
  }

  return (
    <DashboardLayout>
      <MyEbooksPage />
    </DashboardLayout>
  );
}
