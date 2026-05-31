"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ZONES, type DeckDetail, type DeckEntry } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AddCard } from "@/components/add-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DeckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading, error } = useQuery<DeckDetail>({
    queryKey: ["deck", id],
    queryFn: () => api.get(`/decks/${id}`),
    enabled: !!user,
  });

  const byZone = useMemo(() => {
    const m: Record<string, DeckEntry[]> = {};
    for (const z of ZONES) m[z] = [];
    if (data) for (const e of data.entries) (m[e.zone] ||= []).push(e);
    return m;
  }, [data]);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["deck", id] });

  async function updateQty(e: DeckEntry, next: number) {
    if (next < 0) return;
    if (next === 0) return remove(e.id);
    await api.patch(`/decks/${id}/cards/${e.id}`, { quantity: next });
    refresh();
  }

  async function moveZone(e: DeckEntry, zone: string) {
    await api.patch(`/decks/${id}/cards/${e.id}`, { zone });
    refresh();
  }

  async function remove(entryId: string) {
    await api.del(`/decks/${id}/cards/${entryId}`);
    refresh();
  }

  async function deleteDeck() {
    if (!confirm("Delete this deck?")) return;
    await api.del(`/decks/${id}`);
    router.push("/decks");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Link href="/decks" className="text-sm text-muted-foreground hover:underline">
            ← Decks
          </Link>
          <h1 className="text-2xl font-semibold">{data.deck.name}</h1>
          <p className="text-muted-foreground text-sm">
            {data.deck.format ? `${data.deck.format} · ` : ""}
            {data.deck.card_count} cards
            {data.deck.description ? ` · ${data.deck.description}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Close" : "Add card"}</Button>
          <Button variant="outline" onClick={deleteDeck}>
            Delete
          </Button>
        </div>
      </div>

      {showAdd && <AddCard target={{ kind: "deck", deckId: id }} onAdded={refresh} />}

      {ZONES.map((zone) => {
        const items = byZone[zone];
        if (!items || items.length === 0) return null;
        const subtotal = items.reduce((s, e) => s + e.quantity, 0);
        return (
          <section key={zone} className="space-y-2">
            <h2 className="text-lg font-medium capitalize">
              {zone}{" "}
              <span className="text-sm text-muted-foreground">({subtotal})</span>
            </h2>
            <div className="grid gap-2">
              {items.map((e) => (
                <Card key={e.id}>
                  <CardContent className="flex items-center gap-3 p-3">
                    {e.image_uris?.small || e.image_uris?.normal ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={(e.image_uris.small as string) || (e.image_uris.normal as string)}
                        alt={e.card_name}
                        className="h-16 w-auto rounded"
                      />
                    ) : (
                      <div className="h-16 w-12 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {e.oracle_id ? (
                          <Link href={`/cards/${e.oracle_id}`} className="font-medium hover:underline">
                            {e.card_name}
                          </Link>
                        ) : (
                          <span className="font-medium">{e.card_name}</span>
                        )}
                        {e.finish !== "nonfoil" && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{e.finish}</span>
                        )}
                        {e.mana_cost && (
                          <span className="text-xs text-muted-foreground">{e.mana_cost}</span>
                        )}
                        {e.quantity > e.owned_quantity && (
                          <span
                            className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive"
                            title={`You own ${e.owned_quantity} but this deck needs ${e.quantity}`}
                          >
                            short {e.quantity - e.owned_quantity}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {e.set_name} ({e.set_code?.toUpperCase()}) · #{e.collector_number} · {e.type_line}
                        {" · "}own {e.owned_quantity}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => updateQty(e, e.quantity - 1)}>
                        −
                      </Button>
                      <span className="min-w-6 text-center text-sm tabular-nums">{e.quantity}</span>
                      <Button variant="outline" size="sm" onClick={() => updateQty(e, e.quantity + 1)}>
                        +
                      </Button>
                    </div>

                    <select
                      value={e.zone}
                      onChange={(ev) => moveZone(e, ev.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {ZONES.map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </select>

                    <Button variant="ghost" size="sm" onClick={() => remove(e.id)}>
                      ✕
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      {data.entries.length === 0 && (
        <p className="text-muted-foreground">This deck is empty. Click <em>Add card</em> to start.</p>
      )}
    </div>
  );
}
