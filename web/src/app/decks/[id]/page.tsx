"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ZONES, type DeckDetail, type DeckEntry } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AddCardDialog } from "@/components/add-card";
import { ManaCost } from "@/components/mana-cost";
import { Button } from "@/components/ui/button";

// Render order for zones on this page. Commander first so the deck's
// identity is visible immediately; the `ZONES` constant keeps a logical
// listing order ("main" first) used in form dropdowns elsewhere.
const ZONE_DISPLAY_ORDER = ["commander", "main", "sideboard", "maybeboard"] as const;

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
  if (isLoading) return <p className="text-slate-400">Loading…</p>;
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
          <Link href="/decks" className="text-sm text-slate-400 hover:text-white hover:underline">
            ← Decks
          </Link>
          <h1 className="text-2xl font-semibold text-white">{data.deck.name}</h1>
          <p className="text-slate-400 text-sm">
            {data.deck.format ? `${data.deck.format} · ` : ""}
            {data.deck.card_count} cards
            {data.deck.description ? ` · ${data.deck.description}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowAdd(true)}
            className="bg-amber-500 text-black hover:bg-amber-400"
          >
            Add card
          </Button>
          <Button
            variant="outline"
            onClick={deleteDeck}
            className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            Delete
          </Button>
        </div>
      </div>

      <AddCardDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        target={{ kind: "deck", deckId: id }}
        onAdded={refresh}
      />

      {ZONE_DISPLAY_ORDER.map((zone) => {
        const items = byZone[zone];
        if (!items || items.length === 0) return null;
        const subtotal = items.reduce((s, e) => s + e.quantity, 0);
        return (
          <section key={zone} className="space-y-2">
            <h2 className="text-lg font-medium capitalize text-white">
              {zone}{" "}
              <span className="text-sm text-slate-400">({subtotal})</span>
            </h2>
            <div className="grid gap-2">
              {items.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <Link
                    href={`/collection/items/${e.collection_item_id}`}
                    aria-label={`Open ${e.card_name}`}
                    className="shrink-0 transition hover:opacity-80"
                  >
                    {e.image_uris?.small || e.image_uris?.normal ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={(e.image_uris.small as string) || (e.image_uris.normal as string)}
                        alt={e.card_name}
                        className="h-16 w-auto rounded"
                      />
                    ) : (
                      <div className="h-16 w-12 rounded bg-white/10" />
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/collection/items/${e.collection_item_id}`}
                        className="font-medium text-white hover:underline"
                      >
                        {e.card_name}
                      </Link>
                      {e.finish !== "nonfoil" && (
                        <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-xs text-purple-300">{e.finish}</span>
                      )}
                      {e.mana_cost && <ManaCost cost={e.mana_cost} />}
                      {e.quantity > e.owned_quantity && (
                        <span
                          className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive"
                          title={`You own ${e.owned_quantity} but this deck needs ${e.quantity}`}
                        >
                          short {e.quantity - e.owned_quantity}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {e.set_name} ({e.set_code?.toUpperCase()}) · #{e.collector_number} · {e.type_line}
                      {" · "}own {e.owned_quantity}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateQty(e, e.quantity - 1)}
                      className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                      −
                    </Button>
                    <span className="min-w-6 text-center text-sm tabular-nums text-white">{e.quantity}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateQty(e, e.quantity + 1)}
                      className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                      +
                    </Button>
                  </div>

                  <select
                    value={e.zone}
                    onChange={(ev) => moveZone(e, ev.target.value)}
                    className="h-9 rounded-md border border-white/10 bg-white/5 px-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  >
                    {ZONES.map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(e.id)}
                    className="text-slate-400 hover:text-white"
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {data.entries.length === 0 && (
        <p className="text-slate-400">This deck is empty. Click <em>Add card</em> to start.</p>
      )}
    </div>
  );
}
