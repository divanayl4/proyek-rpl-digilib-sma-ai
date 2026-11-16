import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role;

  switch (role) {
    case "ADMIN":
      redirect("/admin");
    case "LIBRARIAN":
      redirect("/librarian");
    case "STUDENT":
      redirect("/student");
    case "TEACHER":
      redirect("/teacher");
    case "STAFF":
      redirect("/staff");
    default:
      // Fallback
      redirect("/student");
  }
}
