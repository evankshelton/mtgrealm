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

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
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
      <Link href="/marketplace" className="text-sm text-slate-400 hover:text-white hover:underline">
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
            <div className="aspect-[5/7] rounded-lg bg-white/10" />
          )}
        </div>

        <div className="space-y-4">
          <header className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-white">{l.card_name}</h1>
            <p className="text-sm text-slate-400">
              {l.set_name} ({l.set_code?.toUpperCase()}) · #{l.collector_number} · {l.rarity}
            </p>
            <p className="text-sm text-slate-400">
              {l.card_condition} · {l.finish} · {l.lang}
            </p>
          </header>

          {/* Price & add to cart */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="flex items-baseline gap-3">
              <div className="text-3xl font-semibold text-white">
                {formatMoney(l.price_cents, l.currency)}
              </div>
              <div className="text-sm text-slate-400">{l.quantity} available</div>
            </div>
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="qty" className="text-slate-300">Quantity</Label>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  max={l.quantity}
                  value={qty}
                  onChange={(e) =>
                    setQty(Math.min(l.quantity, Math.max(1, parseInt(e.target.value || "1", 10))))
                  }
                  className="w-24 border-white/10 bg-white/5 text-white focus-visible:ring-amber-500/50"
                />
              </div>
              <Button
                onClick={addToCart}
                disabled={adding || l.quantity <= 0}
                className="bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-60"
              >
                {adding ? "Adding…" : l.quantity <= 0 ? "Sold out" : "Add to cart"}
              </Button>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>

          {/* Store info */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/8 px-4 py-3">
              <Link
                href={`/marketplace/stores/${l.store_slug}`}
                className="text-base font-medium text-white hover:underline"
              >
                {l.store_name}
              </Link>
            </div>
            <div className="space-y-2 p-4 text-sm">
              {data.review_count > 0 ? (
                <div className="text-slate-300">
                  ★ {data.avg_rating?.toFixed(1)} · {data.review_count} review
                  {data.review_count === 1 ? "" : "s"}
                </div>
              ) : (
                <div className="text-slate-400">No reviews yet.</div>
              )}
              {data.return_policy && (
                <div className="text-slate-400">
                  <span className="font-medium text-slate-300">Return policy:</span>{" "}
                  {data.return_policy}
                </div>
              )}
            </div>
          </div>

          {l.description && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300 whitespace-pre-line">
              {l.description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
