"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Menu, User, ChevronDown, Check, Info, AlertTriangle, CheckCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface TopbarProps {
  onMenuClick: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  LIBRARIAN: "Pustakawan",
  STUDENT: "Siswa",
  TEACHER: "Guru",
  STAFF: "Staf",
};

const ROLE_BADGES: Record<string, string> = {
  ADMIN: "badge-purple",
  LIBRARIAN: "badge-blue",
  STUDENT: "badge-green",
  TEACHER: "badge-yellow",
  STAFF: "badge-blue",
};

export default function Topbar({ onMenuClick }: TopbarProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!session?.user) return;
    try {
      const res = await fetch("/api/notifications?limit=5");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error(err);
    }
  }, [session]);

  useEffect(() => {
    fetchNotifications();
    // Poll every 5 minutes
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    // Close dropdown on click outside
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAllAsRead = async () => {
    try {
      const res = await fetch("/api/notifications", { method: "PATCH" });
      if (res.ok) {
        setUnreadCount(0);
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const markAsReadAndNavigate = async (notif: any) => {
    if (!notif.isRead) {
      try {
        await fetch(`/api/notifications/${notif.id}`, { method: "PATCH" });
        setUnreadCount((prev) => Math.max(0, prev - 1));
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
        );
      } catch (err) {
        console.error(err);
      }
    }
    
    setShowNotifications(false);
    if (notif.link) {
      router.push(notif.link);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "SUCCESS": return <CheckCircle size={16} className="text-success" />;
      case "ERROR": return <AlertTriangle size={16} className="text-danger" />;
      case "WARNING": return <AlertTriangle size={16} className="text-warning" />;
      default: return <Info size={16} className="text-info" />;
    }
  };

  return (
    <header className="app-topbar">
      {/* Mobile Menu Button */}
      <button 
        type="button"
        onClick={onMenuClick}
        className="topbar-icon-btn md:hidden"
        aria-label="Buka menu navigasi"
      >
        <Menu size={22} />
      </button>

      {/* Brand on mobile */}
      <div className="md:hidden flex-1 min-w-0">
        <p className="font-bold text-main leading-tight truncate">DigiLib</p>
        <p className="text-[10px] text-muted leading-tight truncate">SMA Negeri 1</p>
      </div>

      {/* Page Title / Breadcrumb Placeholder */}
      <div className="hidden md:block min-w-0">
        <h2 className="font-semibold text-lg text-main truncate">
          {/* We can inject dynamic title here if needed */}
          Selamat Datang, {session?.user?.name || "Pengguna"}!
        </h2>
        <p className="text-xs text-muted mt-0.5">Semoga harimu menyenangkan di perpustakaan digital.</p>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-1.5 sm:gap-3">
        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button 
            type="button"
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowProfileMenu(false);
            }}
            className="topbar-icon-btn relative"
            aria-label={`Notifikasi${unreadCount > 0 ? `, ${unreadCount} belum dibaca` : ""}`}
            aria-expanded={showNotifications}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-0.5 text-[9px] flex items-center justify-center text-white bg-danger rounded-full border-2 border-surface">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-surface rounded-2xl shadow-xl border border-border overflow-hidden z-50 flex flex-col max-h-[80vh]">
              <div className="p-4 border-b border-border flex justify-between items-center gap-2 bg-surface-blue">
                <h3 className="font-semibold text-sm text-main">Notifikasi</h3>
                {unreadCount > 0 && (
                  <button type="button" onClick={markAllAsRead} className="text-xs text-info font-semibold hover:underline flex items-center gap-1 min-h-11 px-2">
                    <Check size={13} /> Tandai dibaca
                  </button>
                )}
              </div>
              <div className="overflow-y-auto flex-1">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-muted text-sm">
                    Belum ada notifikasi.
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <button
                      type="button"
                      key={notif.id}
                      onClick={() => markAsReadAndNavigate(notif)}
                      className={`w-full text-left p-4 border-b border-border hover:bg-surface-blue cursor-pointer transition-colors flex gap-3 ${!notif.isRead ? 'bg-primary/5' : ''}`}
                    >
                      <div className="mt-0.5 flex-shrink-0">{getIcon(notif.type)}</div>
                      <div className="min-w-0">
                        <p className={`text-sm break-words ${!notif.isRead ? 'font-semibold text-main' : 'font-medium text-muted'}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">{notif.message}</p>
                        <p className="text-[10px] text-muted mt-2">
                          {new Date(notif.createdAt).toLocaleDateString("id-ID", { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="p-3 border-t border-border bg-base text-center">
                <Link 
                  href="/notifications" 
                  onClick={() => setShowNotifications(false)}
                  className="inline-flex items-center justify-center min-h-11 px-2 text-xs text-primary font-medium hover:underline"
                >
                  Lihat Semua Notifikasi
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="relative">
          <button 
            type="button"
            onClick={() => {
              setShowProfileMenu(!showProfileMenu);
              setShowNotifications(false);
            }}
            className="flex items-center gap-2 p-1.5 sm:pr-2.5 rounded-full hover:bg-surface-purple transition-colors min-h-11"
            aria-label="Buka menu profil"
            aria-expanded={showProfileMenu}
          >
            <div className="avatar-circle">
              {session?.user?.name?.charAt(0) || "U"}
            </div>
            <div className="hidden md:block text-left mr-1 min-w-0">
              <p className="text-sm font-semibold leading-none mb-1 text-main truncate max-w-[10rem]">{session?.user?.name || "User"}</p>
              <span className={`badge ${ROLE_BADGES[session?.user?.role || ""] || "badge-default"} min-h-0 py-0.5 text-[10px]`}>
                {ROLE_LABELS[session?.user?.role || ""] || session?.user?.role || "Guest"}
              </span>
            </div>
            <ChevronDown size={16} className="text-muted hidden md:block" />
          </button>

          {showProfileMenu && (
            <div className="absolute right-0 mt-2 w-52 bg-surface rounded-xl shadow-lg border border-border overflow-hidden z-50">
              <div className="p-2">
                <Link
                  href="/profile"
                  onClick={() => setShowProfileMenu(false)}
                  className="px-3 py-2.5 text-sm text-main hover:bg-surface-purple rounded-lg cursor-pointer flex items-center gap-2 min-h-11"
                >
                  <User size={16} /> Profil Saya
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
