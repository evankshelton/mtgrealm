"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatMoney,
  type CollectionDetail,
  type CollectionItem,
  type MarketplaceListing,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ListingsResp = { data: MarketplaceListing[] };

export default function StoreListingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const listingsQ = useQuery<ListingsResp>({
    queryKey: ["store-listings"],
    queryFn: () => api.get("/store/listings"),
    enabled: !!user,
  });

  const [creating, setCreating] = useState(false);

  if (loading || !user) return null;
  if (listingsQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;

  const refresh = () => qc.invalidateQueries({ queryKey: ["store-listings"] });

  async function updateStatus(id: string, status: string) {
    await api.patch(`/store/listings/${id}`, { status });
    refresh();
  }
  async function remove(id: string) {
    if (!confirm("Delist this listing?")) return;
    await api.del(`/store/listings/${id}`);
    refresh();
  }

  return (
    <div className="space-y-6">
      <Link href="/store" className="text-sm text-muted-foreground hover:underline">← Store</Link>
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Your listings</h1>
        <Button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New listing"}</Button>
      </div>

      {creating && (
        <CreateListing onCreated={() => { refresh(); setCreating(false); }} />
      )}

      {listingsQ.data?.data.length === 0 && (
        <p className="text-muted-foreground">No listings yet.</p>
      )}

      <div className="space-y-2">
        {listingsQ.data?.data.map((l) => (
          <Card key={l.id}>
            <CardContent className="flex items-center gap-3 p-3">
              {l.image_uris?.small || l.image_uris?.normal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image_uris.small || l.image_uris.normal} alt={l.card_name} className="h-16 w-auto rounded" />
              ) : (
                <div className="h-16 w-12 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  <Link href={`/marketplace/listings/${l.id}`} className="hover:underline">{l.card_name}</Link>
                </div>
                <div className="text-xs text-muted-foreground">
                  {l.set_name} · {l.card_condition} · {l.finish} · {l.lang}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatMoney(l.price_cents, l.currency)} · qty {l.quantity} · status {l.status}
                </div>
              </div>
              <select
                value={l.status}
                onChange={(e) => updateStatus(l.id, e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="sold_out">sold_out</option>
                <option value="delisted">delisted</option>
              </select>
              <Button variant="ghost" size="sm" onClick={() => remove(l.id)}>✕</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CreateListing({ onCreated }: { onCreated: () => void }) {
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<CollectionItem | null>(null);
  const [qty, setQty] = useState(1);
  const [priceDollars, setPriceDollars] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery<CollectionDetail>({
    queryKey: ["collection"],
    queryFn: () => api.get("/collection"),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!filter) return data.items.slice(0, 30);
    const q = filter.toLowerCase();
    return data.items.filter((it) => it.card_name.toLowerCase().includes(q)).slice(0, 30);
  }, [data, filter]);

  async function submit() {
    if (!picked) return;
    setSubmitting(true);
    setErr(null);
    try {
      const cents = Math.round(parseFloat(priceDollars) * 100);
      if (!cents || cents <= 0) throw new Error("price required");
      await api.post("/store/listings", {
        collection_item_id: picked.id,
        quantity: qty,
        price_cents: cents,
        description: desc || null,
      });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">List a card from your collection</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!picked && (
          <>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter your collection…" />
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {filtered.map((it) => (
                <button
                  key={it.id}
                  onClick={() => setPicked(it)}
                  className="flex items-center gap-3 rounded border p-2 text-left hover:bg-accent"
                >
                  {it.image_uris?.small || it.image_uris?.normal ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={(it.image_uris.small as string) || (it.image_uris.normal as string)} alt={it.card_name} className="h-16 w-auto rounded" />
                  ) : (
                    <div className="h-16 w-12 rounded bg-muted" />
                  )}
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{it.card_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {it.set_name} ({it.set_code?.toUpperCase()}) · {it.card_condition} · {it.finish} · own {it.quantity}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {picked && (
          <>
            <div className="flex gap-3">
              {picked.image_uris?.normal && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picked.image_uris.normal as string} alt={picked.card_name} className="h-32 w-auto rounded" />
              )}
              <div className="text-sm">
                <div className="font-medium">{picked.card_name}</div>
                <div className="text-muted-foreground">
                  {picked.set_name} ({picked.set_code?.toUpperCase()}) · {picked.card_condition} ·{" "}
                  {picked.finish} · {picked.lang}
                </div>
                <div className="text-muted-foreground">You own {picked.quantity}.</div>
                <Button variant="link" size="sm" className="px-0" onClick={() => setPicked(null)}>
                  ← Pick a different card
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="qty">Quantity to list</Label>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  max={picked.quantity}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(picked.quantity, parseInt(e.target.value || "1", 10))))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="price">Price each ($)</Label>
                <Input id="price" type="number" step="0.01" min="0" value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="desc">Description (optional)</Label>
              <Input id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Anything buyers should know" />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button onClick={submit} disabled={submitting}>{submitting ? "Listing…" : "Create listing"}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
