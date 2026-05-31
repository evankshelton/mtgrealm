"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  CONDITIONS,
  type CollectionDetail,
  type CollectionItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AddCard } from "@/components/add-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type Filter = "all" | "in_decks" | "for_sale" | "unassigned";

export default function CollectionPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading, error } = useQuery<CollectionDetail>({
    queryKey: ["collection"],
    queryFn: () => api.get("/collection"),
    enabled: !!user,
  });

  const items = useMemo(() => {
    if (!data) return [];
    let xs = data.items;
    if (search) {
      const q = search.toLowerCase();
      xs = xs.filter((it) => it.card_name.toLowerCase().includes(q));
    }
    switch (filter) {
      case "in_decks":
        xs = xs.filter((it) => it.in_decks.length > 0);
        break;
      case "for_sale":
        xs = xs.filter((it) => it.in_listings.length > 0);
        break;
      case "unassigned":
        xs = xs.filter((it) => it.in_decks.length === 0 && it.in_listings.length === 0);
        break;
    }
    return xs;
  }, [data, search, filter]);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["collection"] });

  async function remove(itemId: string) {
    if (!confirm("Remove this card from your collection?")) return;
    await api.del(`/collection/items/${itemId}`);
    refresh();
  }

  async function updateQty(item: CollectionItem, next: number) {
    if (next < 0) return;
    if (next === 0) return remove(item.id);
    await api.patch(`/collection/items/${item.id}`, { quantity: next });
    refresh();
  }

  async function setCondition(item: CollectionItem, cond: string) {
    await api.patch(`/collection/items/${item.id}`, { card_condition: cond });
    refresh();
  }

  const totals = {
    distinct: data.items.length,
    quantity: data.items.reduce((s, it) => s + it.quantity, 0),
    inDecks: data.items.filter((it) => it.in_decks.length > 0).length,
    forSale: data.items.filter((it) => it.in_listings.length > 0).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your collection</h1>
          <p className="text-muted-foreground text-sm">
            {totals.quantity.toLocaleString()} cards across {totals.distinct.toLocaleString()} entries
            {" · "}
            {totals.inDecks} in decks {" · "} {totals.forSale} for sale
          </p>
        </div>
        <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Close" : "Add card"}</Button>
      </div>

      {showAdd && <AddCard target={{ kind: "collection" }} onAdded={refresh} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name…"
          className="max-w-xs"
        />
        <div className="flex gap-1 text-sm">
          {(["all", "in_decks", "for_sale", "unassigned"] as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "in_decks" ? "In decks" : f === "for_sale" ? "For sale" : "Unassigned"}
            </Button>
          ))}
        </div>
      </div>

      {data.items.length === 0 ? (
        <p className="text-muted-foreground">
          Your collection is empty. Click <em>Add card</em> to start tracking what you own.
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">No cards match the current filter.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="flex items-center gap-3 p-3">
                {it.image_uris?.small || it.image_uris?.normal ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(it.image_uris.small as string) || (it.image_uris.normal as string)}
                    alt={it.card_name}
                    className="h-20 w-auto rounded"
                  />
                ) : (
                  <div className="h-20 w-14 rounded bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {it.oracle_id ? (
                      <Link href={`/cards/${it.oracle_id}`} className="font-medium hover:underline">
                        {it.card_name}
                      </Link>
                    ) : (
                      <span className="font-medium">{it.card_name}</span>
                    )}
                    {it.finish !== "nonfoil" && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{it.finish}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {it.set_name} ({it.set_code?.toUpperCase()}) · #{it.collector_number} ·{" "}
                    {it.rarity} · {it.lang}
                  </div>
                  {(it.in_decks.length > 0 || it.in_listings.length > 0) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      {it.in_decks.map((d, i) => (
                        <Link
                          key={`deck-${d.deck_id}-${d.zone}-${i}`}
                          href={`/decks/${d.deck_id}`}
                          className="rounded bg-accent px-1.5 py-0.5 hover:bg-accent/70"
                          title={`${d.quantity}x in ${d.zone}`}
                        >
                          {d.deck_name}
                          {d.zone !== "main" ? ` (${d.zone})` : ""}
                          {d.quantity > 1 ? ` ×${d.quantity}` : ""}
                        </Link>
                      ))}
                      {it.in_listings.map((l) => (
                        <span
                          key={`listing-${l.listing_id}`}
                          className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
                          title={`Listed: ${l.quantity}x at ${formatPrice(l.price_cents, l.currency)}`}
                        >
                          for sale · {formatPrice(l.price_cents, l.currency)}
                          {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => updateQty(it, it.quantity - 1)}>
                    −
                  </Button>
                  <span className="min-w-6 text-center text-sm tabular-nums">{it.quantity}</span>
                  <Button variant="outline" size="sm" onClick={() => updateQty(it, it.quantity + 1)}>
                    +
                  </Button>
                </div>

                <select
                  value={it.card_condition}
                  onChange={(e) => setCondition(it, e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {CONDITIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>

                <Button variant="ghost" size="sm" onClick={() => remove(it.id)}>
                  ✕
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
