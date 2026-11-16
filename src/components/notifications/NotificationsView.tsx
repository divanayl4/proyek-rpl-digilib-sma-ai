"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Info, AlertTriangle, CheckCircle, Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/Button";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

export default function NotificationsView() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const limit = 20;

  const fetchNotifications = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    try {
      const skip = (pageNum - 1) * limit;
      const res = await fetch(`/api/notifications?limit=${limit}&skip=${skip}`);
      if (res.ok) {
        const data = await res.json();
        if (append) {
          setNotifications((prev) => [...prev, ...(data.notifications || [])]);
        } else {
          setNotifications(data.notifications || []);
        }
        setHasMore(data.total > skip + limit);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchNotifications(1);
  }, [fetchNotifications]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage, true);
  };

  const markAllAsRead = async () => {
    try {
      const res = await fetch("/api/notifications", { method: "PATCH" });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const markAsReadAndNavigate = async (notif: Notification) => {
    if (!notif.isRead) {
      try {
        await fetch(`/api/notifications/${notif.id}`, { method: "PATCH" });
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
        );
      } catch (err) {
        console.error(err);
      }
    }
    
    if (notif.link) {
      router.push(notif.link);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "SUCCESS": return <CheckCircle size={20} className="text-success" />;
      case "ERROR": return <AlertTriangle size={20} className="text-danger" />;
      case "WARNING": return <AlertTriangle size={20} className="text-warning" />;
      default: return <Info size={20} className="text-info" />;
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <Bell size={24} className="text-primary flex-shrink-0" aria-hidden="true" /> Semua Notifikasi
          </h1>
          <p className="page-description">Riwayat pemberitahuan aktivitas Anda</p>
        </div>
        <div className="page-actions">
          <Button onClick={markAllAsRead} variant="secondary" className="text-sm">
            <Check size={16} className="mr-2" /> Tandai Semua Dibaca
          </Button>
        </div>
      </div>

      <div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="divide-y divide-border">
          {loading && notifications.length === 0 ? (
            <div className="p-10"><LoadingState message="Memuat notifikasi..." /></div>
          ) : notifications.length === 0 ? (
            <div className="p-10 text-center text-muted">
              <Bell size={48} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
              <p>Belum ada notifikasi sama sekali.</p>
            </div>
          ) : (
            notifications.map((notif) => (
              <button
                type="button"
                key={notif.id}
                onClick={() => markAsReadAndNavigate(notif)}
                className={`w-full text-left p-4 sm:p-5 hover:bg-base focus-visible:bg-base cursor-pointer transition-colors flex gap-3 sm:gap-4 ${!notif.isRead ? 'bg-primary/5' : ''}`}
              >
                <div className="mt-1 flex-shrink-0">{getIcon(notif.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-base ${!notif.isRead ? 'font-semibold text-main' : 'font-medium text-muted'}`}>
                    {notif.title}
                  </p>
                  <p className="text-sm text-muted mt-1 leading-relaxed">{notif.message}</p>
                  <p className="text-xs text-muted mt-2 font-medium">
                    {new Date(notif.createdAt).toLocaleDateString("id-ID", { 
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                    })}
                  </p>
                </div>
                {!notif.isRead && (
                  <div className="flex-shrink-0 self-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary" aria-hidden="true"></div>
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {hasMore && (
          <div className="p-6 border-t border-border bg-base text-center">
            <Button onClick={loadMore} variant="secondary" disabled={loading}>
              {loading ? "Memuat..." : "Muat Lebih Banyak"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
