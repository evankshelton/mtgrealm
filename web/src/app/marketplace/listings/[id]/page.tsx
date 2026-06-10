"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney, type MarketplaceListing } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Resp = {
  listing: MarketplaceListing;
  return_policy: string | null;
  avg_rating: number | null;
  review_count: number;
};

export default function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["listing", id],
    queryFn: () => api.get(`/marketplace/listings/${id}`),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data) return null;
  const l = data.listing;

  async function addToCart() {
    if (!user) {
      router.push("/login");
      return;
    }
    setAdding(true);
    setErr(null);
    try {
      await api.post(`/cart/items`, { listing_id: id, quantity: qty });
      qc.invalidateQueries({ queryKey: ["cart"] });
      router.push("/cart");
    } catch (e) {
      setErr((e as Error).message || "Could not add to cart");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/marketplace" className="text-sm text-muted-foreground hover:underline">
        ← Back to marketplace
      </Link>

      <div className="grid gap-6 md:grid-cols-[minmax(220px,300px)_1fr]">
        <div>
          {l.image_uris?.large || l.image_uris?.normal ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={l.image_uris.large || l.image_uris.normal}
              alt={l.card_name}
              className="w-full rounded-lg shadow"
            />
          ) : (
            <div className="aspect-[5/7] rounded-lg bg-muted" />
          )}
        </div>

        <div className="space-y-4">
          <header className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">{l.card_name}</h1>
            <p className="text-sm text-muted-foreground">
              {l.set_name} ({l.set_code?.toUpperCase()}) · #{l.collector_number} · {l.rarity}
            </p>
            <p className="text-sm text-muted-foreground">
              {l.card_condition} · {l.finish} · {l.lang}
            </p>
            {l.oracle_id && (
              <p className="text-xs">
                <Link href={`/cards/${l.oracle_id}`} className="text-muted-foreground hover:underline">
                  See card rules text →
                </Link>
              </p>
            )}
          </header>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-baseline gap-3">
                <div className="text-3xl font-semibold">
                  {formatMoney(l.price_cents, l.currency)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {l.quantity} available
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="qty">Quantity</Label>
                  <Input
                    id="qty"
                    type="number"
                    min={1}
                    max={l.quantity}
                    value={qty}
                    onChange={(e) =>
                      setQty(Math.min(l.quantity, Math.max(1, parseInt(e.target.value || "1", 10))))
                    }
                    className="w-24"
                  />
                </div>
                <Button onClick={addToCart} disabled={adding || l.quantity <= 0}>
                  {adding ? "Adding…" : l.quantity <= 0 ? "Sold out" : "Add to cart"}
                </Button>
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                <Link href={`/marketplace/stores/${l.store_slug}`} className="hover:underline">
                  {l.store_name}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.review_count > 0 ? (
                <div>
                  ★ {data.avg_rating?.toFixed(1)} · {data.review_count} review
                  {data.review_count === 1 ? "" : "s"}
                </div>
              ) : (
                <div className="text-muted-foreground">No reviews yet.</div>
              )}
              {data.return_policy && (
                <div className="whitespace-pre-line text-muted-foreground">
                  <span className="font-medium text-foreground">Return policy:</span>{" "}
                  {data.return_policy}
                </div>
              )}
            </CardContent>
          </Card>

          {l.description && (
            <Card>
              <CardContent className="whitespace-pre-line p-4 text-sm">
                {l.description}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
