"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, formatMoney, type Order } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";

export default function SellerOrdersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<{ data: Order[] }>({
    queryKey: ["orders", "seller"],
    queryFn: () => api.get("/orders?scope=seller"),
    enabled: !!user,
  });

  if (loading || !user) return null;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <Link href="/store" className="text-sm text-muted-foreground hover:underline">← Store</Link>
      <h1 className="text-2xl font-semibold">Incoming orders</h1>

      {data?.data.length === 0 && (
        <p className="text-muted-foreground">No orders yet.</p>
      )}
      {data?.data.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`}>
          <Card className="transition hover:shadow-md">
            <CardContent className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {o.buyer_name || o.buyer_email}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(o.created_at).toLocaleString()} · {o.item_count} item
                  {o.item_count === 1 ? "" : "s"} · status {o.status}
                  {o.tracking_number ? ` · ${o.tracking_carrier ?? ""} ${o.tracking_number}` : ""}
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {formatMoney(o.total_cents, o.currency)}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
