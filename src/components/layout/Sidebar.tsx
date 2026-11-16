"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  BookOpen, 
  LayoutDashboard, 
  Users, 
  Library, 
  History, 
  Search,
  BookMarked,
  Settings,
  User as UserIcon,
  LogOut,
  Sparkles,
  PieChart,
  FileText,
  ScrollText,
  Coins,
  Activity,
  Bot,
  MessageCircle
} from "lucide-react";
import { signOut } from "next-auth/react";

interface SidebarProps {
  role: string;
  isMobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ role, isMobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  const getLinksByRole = () => {
    switch (role) {
      case "ADMIN":
        return [
          { href: "/admin", label: "Dasbor Admin", icon: LayoutDashboard },
          { href: "/admin/users", label: "Kelola Pengguna", icon: Users },
          { href: "/admin/books", label: "Katalog Buku", icon: Library },
          { href: "/admin/transactions", label: "Transaksi", icon: History },
          { href: "/librarian/fines", label: "Denda", icon: Coins },
          { href: "/admin/monitoring", label: "Monitoring", icon: BookMarked },
          { href: "/admin/ebook-activity", label: "Aktivitas Membaca", icon: Activity },
          { href: "/admin/reports", label: "Laporan & Analitik", icon: PieChart },
          { href: "/admin/audit", label: "Audit Log", icon: ScrollText },
          { href: "/admin/settings", label: "Tarif Denda", icon: Settings },
          { href: "/admin/ai-config", label: "Konfigurasi AI", icon: Bot },
          { href: "/admin/whatsapp", label: "Notifikasi WhatsApp", icon: MessageCircle },
          { href: "/ebooks", label: "Katalog Ebook", icon: FileText },
        ];
      case "LIBRARIAN":
        return [
          { href: "/librarian", label: "Dasbor Pustakawan", icon: LayoutDashboard },
          { href: "/librarian/books", label: "Kelola Koleksi", icon: Library },
          { href: "/librarian/borrows", label: "Peminjaman", icon: BookMarked },
          { href: "/librarian/fines", label: "Denda", icon: Coins },
          { href: "/librarian/settings", label: "Tarif Denda", icon: Settings },
          { href: "/ebooks", label: "Katalog Ebook", icon: FileText },
        ];
      case "STUDENT":
        return [
          { href: "/student", label: "Dasbor Siswa", icon: LayoutDashboard },
          { href: "/catalog", label: "Katalog Buku", icon: Search },
          { href: "/ebooks", label: "Katalog Ebook", icon: FileText },
          { href: "/student/borrows", label: "Buku Dipinjam", icon: BookOpen },
          { href: "/ebooks/saya", label: "Ebook Saya", icon: FileText },
          { href: "/student/history", label: "Riwayat", icon: History },
          { href: "/student/fines", label: "Denda Saya", icon: Coins },
        ];
      case "TEACHER":
        return [
          { href: "/teacher", label: "Dasbor Guru", icon: LayoutDashboard },
          { href: "/catalog", label: "Katalog Referensi", icon: Search },
          { href: "/ebooks", label: "Katalog Ebook", icon: FileText },
          { href: "/teacher/borrows", label: "Buku Dipinjam", icon: BookOpen },
          { href: "/teacher/recommendations", label: "Rekomendasi", icon: Sparkles },
          { href: "/ebooks/saya", label: "Ebook Saya", icon: FileText },
          { href: "/teacher/fines", label: "Denda Saya", icon: Coins },
        ];
      case "STAFF":
        return [
          { href: "/staff", label: "Dasbor Staf", icon: LayoutDashboard },
          { href: "/catalog", label: "Katalog Buku", icon: Library },
          { href: "/ebooks", label: "Katalog Ebook", icon: FileText },
          { href: "/staff/borrows", label: "Buku Dipinjam", icon: BookOpen },
          { href: "/staff/history", label: "Riwayat Transaksi", icon: History },
        ];
      default:
        return [];
    }
  };

  const links = getLinksByRole();

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobileOpen && (
        <div 
          className="modal-backdrop md:hidden" 
          style={{ zIndex: 40 }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      
      {/* Sidebar container */}
      <aside 
        className={`app-sidebar fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } md:static md:flex-shrink-0`}
        aria-label="Navigasi utama"
      >
        {/* Logo */}
        <div className="app-sidebar__brand">
          <div className="app-sidebar__logo" aria-hidden="true">
            <BookOpen size={24} />
          </div>
          <div className="min-w-0">
            <span className="block font-bold text-lg leading-tight text-main tracking-tight">DigiLib</span>
            <p className="text-xs text-muted truncate">SMA Negeri 1</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="app-sidebar__nav">
          <p className="app-sidebar__label">
            Menu Utama
          </p>
          {links.map((link, index) => {
            const Icon = link.icon;
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            const accent = ["purple", "blue", "green", "yellow"][index % 4];
            
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => isMobileOpen && onClose()}
                aria-current={isActive ? "page" : undefined}
                className={`sidebar-link sidebar-link--${accent} ${isActive ? "is-active" : ""}`}
              >
                <span className="sidebar-link__icon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className="truncate">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="app-sidebar__footer">
          <Link
            href="/profile"
            onClick={() => isMobileOpen && onClose()}
            aria-current={pathname === "/profile" ? "page" : undefined}
            className={`sidebar-link sidebar-link--blue ${pathname === "/profile" ? "is-active" : ""}`}
          >
            <span className="sidebar-link__icon" aria-hidden="true">
              <UserIcon size={17} />
            </span>
            <span className="truncate">Profil Saya</span>
          </Link>
          <button 
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="sidebar-link sidebar-link--yellow w-full text-left hover:bg-danger-bg hover:text-danger"
          >
            <span className="sidebar-link__icon" aria-hidden="true">
              <LogOut size={17} />
            </span>
            <span className="truncate">Keluar</span>
          </button>
        </div>
      </aside>
    </>
  );
}
