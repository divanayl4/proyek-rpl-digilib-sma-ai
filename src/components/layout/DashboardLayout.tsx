"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import AssistantWidget from "@/components/ai/AssistantWidget";
import { canUseAIAssistant } from "@/lib/ai/access";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setIsMobileSidebarOpen(!isMobileSidebarOpen);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" aria-hidden="true"></div>
          <p className="text-muted font-medium">Memuat DigiLib...</p>
        </div>
      </div>
    );
  }

  // Fallback role if not logged in (though middleware should protect it)
  const role = session?.user?.role || "STUDENT";
  const isAssistantPage = pathname === "/assistant";
  const canShowAI = canUseAIAssistant(role) && !isAssistantPage;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <Sidebar 
        role={role} 
        isMobileOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        <Topbar onMenuClick={toggleSidebar} />
        
        {/* Main scrollable area */}
        <main className="main-scroll">
          <div className="content-container">
            {children}
          </div>
        </main>
      </div>

      {/* Ikon AI mengapung di kanan bawah (disembunyikan jika sedang berada di halaman /assistant penuh) */}
      {canShowAI && <AssistantWidget />}
    </div>
  );
}
