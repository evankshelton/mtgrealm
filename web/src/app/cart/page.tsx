"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney, type CartLine } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CartPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<{ items: CartLine[] }>({
    queryKey: ["cart"],
    queryFn: () => api.get("/cart"),
    enabled: !!user,
  });

  // Group by store for the per-seller subtotals.
  const groups = useMemo(() => {
    if (!data) return [];
    const byStore: Record<string, CartLine[]> = {};
    for (const it of data.items) {
      (byStore[it.store_id] ||= []).push(it);
    }
    return Object.entries(byStore).map(([storeID, items]) => ({
      storeID,
      storeName: items[0].store_name,
      storeSlug: items[0].store_slug,
      subtotal: items.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0),
      currency: items[0].currency,
      items,
    }));
  }, [data]);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data || data.items.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Button asChild variant="outline">
          <Link href="/marketplace">Browse the marketplace</Link>
        </Button>
      </div>
    );
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ["cart"] });

  async function updateQty(id: string, q: number) {
    if (q <= 0) await api.del(`/cart/items/${id}`);
    else await api.patch(`/cart/items/${id}`, { quantity: q });
    refresh();
  }
  async function remove(id: string) {
    await api.del(`/cart/items/${id}`);
    refresh();
  }

  const grandTotal = groups.reduce((s, g) => s + g.subtotal, 0);
  const currency = groups[0]?.currency || "USD";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Your cart</h1>

      {groups.map((g) => (
        <Card key={g.storeID}>
          <CardHeader>
            <CardTitle className="text-base">
              <Link href={`/marketplace/stores/${g.storeSlug}`} className="hover:underline">
                {g.storeName}
              </Link>
              <span className="ml-2 text-sm text-muted-foreground">
                {g.items.length} listing{g.items.length === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {g.items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 border-b pb-2 last:border-b-0 last:pb-0">
                {it.image_uris?.small || it.image_uris?.normal ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(it.image_uris.small as string) || (it.image_uris.normal as string)}
                    alt={it.card_name}
                    className="h-16 w-auto rounded"
                  />
                ) : (
                  <div className="h-16 w-12 rounded bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.card_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {it.set_name} ({it.set_code?.toUpperCase()}) · {it.card_condition} · {it.finish}
                  </div>
                  {it.quantity > it.available && (
                    <div className="text-xs text-destructive">
                      only {it.available} available — please reduce
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateQty(it.id, it.quantity - 1)}
                  >
                    −
                  </Button>
                  <span className="min-w-6 text-center text-sm tabular-nums">{it.quantity}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={it.quantity >= it.available}
                    onClick={() => updateQty(it.id, it.quantity + 1)}
                  >
                    +
                  </Button>
                </div>
                <div className="w-24 text-right text-sm font-medium tabular-nums">
                  {formatMoney(it.unit_price_cents * it.quantity, it.currency)}
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(it.id)}>
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex justify-end pt-2 text-sm">
              Subtotal: <span className="ml-2 font-semibold">{formatMoney(g.subtotal, g.currency)}</span>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="text-lg">
          Total: <span className="font-semibold">{formatMoney(grandTotal, currency)}</span>
        </div>
        <Button asChild>
          <Link href="/checkout">Continue to checkout</Link>
        </Button>
      </div>
    </div>
  );
}
