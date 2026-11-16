import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import ProfileForm from "@/components/profile/ProfileForm";
import { maskPhoneNumber } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      gender: true,
      identityNumber: true,
      class: true,
      isActive: true,
      createdAt: true,
      whatsappNumber: true,
      whatsappVerified: true,
      whatsappNotificationsEnabled: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  const { whatsappNumber, ...profile } = user;

  return (
    <DashboardLayout>
      <ProfileForm
        user={{
          ...profile,
          whatsappNumberMasked: maskPhoneNumber(whatsappNumber),
        }}
      />
    </DashboardLayout>
  );
}
