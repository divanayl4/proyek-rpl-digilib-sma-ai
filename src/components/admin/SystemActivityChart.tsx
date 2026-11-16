"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardHeader, CardTitle, CardDescription, CardBody } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/LoadingState";
import { Calendar, RefreshCw } from "lucide-react";

interface ActivityPoint {
  date: string;
  physicalBorrows: number;
  physicalReturns: number;
  ebookLoans: number;
}

export default function SystemActivityChart() {
  const [data, setData] = useState<ActivityPoint[]>([]);
  const [period, setPeriod] = useState<string>("7days");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/system-activity?period=${period}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Gagal memuat data aktivitas sistem.");
      }
      const json = await res.json();
      setData(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const totalActivities = data.reduce(
    (sum, d) => sum + d.physicalBorrows + d.physicalReturns + d.ebookLoans,
    0
  );

  return (
    <Card className="card-accent-purple">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="min-w-0">
          <CardTitle>Aktivitas Sistem</CardTitle>
          <CardDescription>Grafik aktivitas peminjaman dan pengembalian</CardDescription>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-surface border border-border px-2.5 py-1 rounded-lg text-xs">
            <Calendar size={14} className="text-muted" aria-hidden="true" />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Pilih periode grafik aktivitas"
              className="bg-transparent text-main font-medium focus:outline-none cursor-pointer"
            >
              <option value="today">Hari Ini</option>
              <option value="7days">7 Hari Terakhir</option>
              <option value="30days">30 Hari Terakhir</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="flex items-center justify-center h-64 rounded-xl bg-bg-subtle border border-border">
            <LoadingState message="Memuat data aktivitas..." />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 rounded-xl bg-bg-subtle border border-border text-center p-6">
            <p className="text-danger text-sm mb-3">{error}</p>
            <button
              onClick={fetchActivity}
              className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
            >
              <RefreshCw size={14} /> Coba lagi
            </button>
          </div>
        ) : totalActivities === 0 || data.length === 0 ? (
          <div className="flex items-center justify-center h-64 rounded-xl bg-bg-subtle border border-border text-center p-6">
            <p className="text-muted text-sm">Belum ada data aktivitas pada periode ini</p>
          </div>
        ) : (
          <div className="h-64 w-full min-w-0 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--color-border)"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => {
                    const parts = String(val).split("-");
                    return parts.length === 3 ? `${parseInt(parts[2], 10)}/${parseInt(parts[1], 10)}` : val;
                  }}
                  style={{ fontSize: "11px", fill: "var(--color-text-muted)" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  style={{ fontSize: "11px", fill: "var(--color-text-muted)" }}
                />
                <RechartsTooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text-main)",
                    fontSize: "12px",
                  }}
                  labelFormatter={(l) => {
                    const d = new Date(String(l));
                    return isNaN(d.getTime())
                      ? String(l)
                      : d.toLocaleDateString("id-ID", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        });
                  }}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
                />
                <Bar
                  dataKey="physicalBorrows"
                  name="Peminjaman Buku Fisik"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="physicalReturns"
                  name="Pengembalian Buku Fisik"
                  fill="var(--color-accent-green)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="ebookLoans"
                  name="Peminjaman Ebook"
                  fill="var(--color-accent-blue)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
