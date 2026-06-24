"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, formatMoney, type Order } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function OrdersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<{ data: Order[]; scope: string }>({
    queryKey: ["orders", "buyer"],
    queryFn: () => api.get("/orders?scope=buyer"),
    enabled: !!user,
  });

  if (loading || !user) return null;
  if (isLoading) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-white">Your orders</h1>
      {data?.data.length === 0 && (
        <p className="text-slate-400">
          You haven&apos;t placed any orders yet.{" "}
          <Link href="/marketplace" className="underline hover:text-white">
            Browse the marketplace
          </Link>
          .
        </p>
      )}
      {data?.data.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`}>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition-colors hover:bg-white/5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white">{o.store_name}</div>
              <div className="text-xs text-slate-400">
                {new Date(o.created_at).toLocaleString()} · {o.item_count} item
                {o.item_count === 1 ? "" : "s"} · {o.status}
              </div>
            </div>
            <div className="text-sm font-semibold tabular-nums text-slate-300">
              {formatMoney(o.total_cents, o.currency)}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
