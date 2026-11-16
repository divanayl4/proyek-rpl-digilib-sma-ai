import DashboardLayout from "@/components/layout/DashboardLayout";
import AIChatView from "@/components/ai/AIChatView";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canUseAIAssistant } from "@/lib/ai/access";

export const metadata = {
  title: "AI Assistant - DigiLib",
};

export default async function AssistantPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !canUseAIAssistant(session.user.role)) {
    redirect("/dashboard");
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto w-full">
        <AIChatView />
      </div>
    </DashboardLayout>
  );
}
