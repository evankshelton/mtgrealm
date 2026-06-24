"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import {
  api,
  CONDITIONS,
  FORMATS,
  formatMoney,
  type CollectionDetail,
  type CollectionItem,
  type Deck,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AddCardDialog } from "@/components/add-card";
import { AddToDeckButton } from "@/components/add-to-deck-dialog";
import { MiniDeckTile } from "@/components/mini-deck-tile";
import { DeckTile } from "@/components/deck-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type Filter = "all" | "in_decks" | "for_sale" | "unassigned";
type DeckListResponse = { data: Deck[]; limit: number };

// ---------------------------------------------------------------------------
// Dark badge helpers (matches marketplace card listings)
// ---------------------------------------------------------------------------

const CONDITION_STYLES: Record<string, string> = {
  NM:  "bg-emerald-900/50 text-emerald-300 ring-emerald-500/30",
  LP:  "bg-blue-900/50 text-blue-300 ring-blue-500/30",
  MP:  "bg-yellow-900/50 text-yellow-300 ring-yellow-500/30",
  HP:  "bg-orange-900/50 text-orange-300 ring-orange-500/30",
  DMG: "bg-red-900/50 text-red-300 ring-red-500/30",
};

function ConditionBadge({ condition }: { condition: string }) {
  const cls = CONDITION_STYLES[condition.toUpperCase()] ?? "bg-white/5 text-slate-400 ring-white/10";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${cls}`}>
      {condition}
    </span>
  );
}

function FinishBadge({ finish }: { finish: string }) {
  const foil = finish !== "nonfoil";
  return (
    <span className={[
      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
      foil
        ? "bg-purple-900/50 text-purple-300 ring-purple-500/30"
        : "bg-white/5 text-slate-400 ring-white/10",
    ].join(" ")}>
      {finish === "nonfoil" ? "Non-foil" : finish === "foil" ? "Foil" : finish}
    </span>
  );
}

function LangBadge({ lang }: { lang: string }) {
  const isEnglish = lang.toLowerCase() === "en";
  return (
    <span className={[
      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
      isEnglish
        ? "bg-white/5 text-slate-400 ring-white/10"
        : "bg-amber-900/50 text-amber-300 ring-amber-500/30",
    ].join(" ")}>
      {lang.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CollectionPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  // New deck dialog
  const [deckOpen, setDeckOpen] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckFormat, setDeckFormat] = useState("");
  const [deckDesc, setDeckDesc] = useState("");
  const [deckErr, setDeckErr] = useState<string | null>(null);
  const [deckSubmitting, setDeckSubmitting] = useState(false);

  // Collection UI
  const [tab, setTab] = useState<"decks" | "collection">("collection");
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data: decksData, isLoading: decksLoading } = useQuery<DeckListResponse>({
    queryKey: ["decks"],
    queryFn: () => api.get("/decks"),
    enabled: !!user,
  });

  const { data: collectionData, isLoading: collectionLoading, error: collectionError } =
    useQuery<CollectionDetail>({
      queryKey: ["collection"],
      queryFn: () => api.get("/collection"),
      enabled: !!user,
    });

  const filteredItems = useMemo(() => {
    if (!collectionData) return [];
    let xs = collectionData.items;
    if (search) {
      const q = search.toLowerCase();
      xs = xs.filter((it) => it.card_name.toLowerCase().includes(q));
    }
    switch (filter) {
      case "in_decks":    xs = xs.filter((it) => it.in_decks.length > 0); break;
      case "for_sale":    xs = xs.filter((it) => it.in_listings.length > 0); break;
      case "unassigned":  xs = xs.filter((it) => it.in_decks.length === 0 && it.in_listings.length === 0); break;
    }
    return xs;
  }, [collectionData, search, filter]);

  if (loading || !user) return null;

  const refreshDecks      = () => qc.invalidateQueries({ queryKey: ["decks"] });
  const refreshCollection = () => qc.invalidateQueries({ queryKey: ["collection"] });

  function openDeckDialog() {
    setDeckName("");
    setDeckFormat("");
    setDeckDesc("");
    setDeckErr(null);
    setDeckOpen(true);
  }

  async function submitDeck(e: React.FormEvent) {
    e.preventDefault();
    setDeckErr(null);
    setDeckSubmitting(true);
    try {
      const created = await api.post<Deck>("/decks", {
        name: deckName.trim(),
        format: deckFormat || null,
        description: deckDesc.trim() || null,
      });
      setDeckOpen(false);
      refreshDecks();
      router.push(`/decks/${created.id}`);
    } catch (err) {
      setDeckErr((err as Error).message);
    } finally {
      setDeckSubmitting(false);
    }
  }

  async function removeCard(itemId: string) {
    if (!confirm("Remove this card from your collection?")) return;
    await api.del(`/collection/items/${itemId}`);
    refreshCollection();
  }

  async function updateQty(item: CollectionItem, next: number) {
    if (next < 0) return;
    if (next === 0) return removeCard(item.id);
    await api.patch(`/collection/items/${item.id}`, { quantity: next });
    refreshCollection();
  }

  async function setConditionVal(item: CollectionItem, cond: string) {
    await api.patch(`/collection/items/${item.id}`, { card_condition: cond });
    refreshCollection();
  }

  const atCap = !!(decksData && decksData.data.length >= decksData.limit);

  const totals = collectionData ? {
    distinct:  collectionData.items.length,
    quantity:  collectionData.items.reduce((s, it) => s + it.quantity, 0),
    inDecks:   collectionData.items.filter((it) => it.in_decks.length > 0).length,
    forSale:   collectionData.items.filter((it) => it.in_listings.length > 0).length,
  } : null;

  return (
    <>
      {/* ── New Deck Dialog ── */}
      <Dialog open={deckOpen} onOpenChange={(o) => { if (!o) setDeckErr(null); setDeckOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New deck</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitDeck} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="dname">Name</Label>
              <Input
                id="dname"
                required
                placeholder="My Commander deck…"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dfmt">Format</Label>
              <select
                id="dfmt"
                value={deckFormat}
                onChange={(e) => setDeckFormat(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">(none)</option>
                {FORMATS.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ddesc">Description</Label>
              <Input
                id="ddesc"
                placeholder="Optional…"
                value={deckDesc}
                onChange={(e) => setDeckDesc(e.target.value)}
              />
            </div>
            {deckErr && <p className="text-sm text-destructive">{deckErr}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeckOpen(false)}
                disabled={deckSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={deckSubmitting || !deckName.trim()}>
                {deckSubmitting ? "Creating…" : "Create deck"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div
        className="-mt-6 overflow-x-hidden text-white"
        style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}
      >
        {/* ── Hero ── */}
        <section
          className="relative overflow-hidden px-6 py-14"
          style={{ background: "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1040 0%, #09090f 60%)" }}
        >
          <div className="pointer-events-none absolute left-5 top-5 h-10 w-10 border-l-2 border-t-2 border-amber-500/30" />
          <div className="pointer-events-none absolute right-5 top-5 h-10 w-10 border-r-2 border-t-2 border-amber-500/30" />

          <div className="relative mx-auto max-w-5xl">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-4xl font-extrabold tracking-tight">Your Collection</h1>
                {totals ? (
                  <p className="mt-1.5 text-slate-400">
                    {totals.quantity.toLocaleString()} cards · {totals.distinct.toLocaleString()} unique entries
                    {totals.inDecks > 0 && (
                      <> · <span className="text-indigo-400">{totals.inDecks} in decks</span></>
                    )}
                    {totals.forSale > 0 && (
                      <> · <span className="text-emerald-400">{totals.forSale} for sale</span></>
                    )}
                  </p>
                ) : (
                  <p className="mt-1.5 text-slate-500 text-sm">Loading…</p>
                )}
              </div>

            </div>
          </div>
        </section>

        {/* ── Tab bar ── */}
        <div className="border-b border-white/10" style={{ background: "#0c0c14" }}>
          <div className="mx-auto max-w-5xl px-6">
            <div className="flex">
              {(["collection", "decks"] as const).map((t) => {
                const label = t === "collection"
                  ? `Collection${totals ? ` · ${totals.quantity.toLocaleString()} cards` : ""}`
                  : `Decks${decksData ? ` · ${decksData.data.length}` : ""}`;
                return (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={[
                      "border-b-2 px-8 py-5 text-xl font-semibold -mb-px transition-colors",
                      tab === t
                        ? "border-amber-500 text-white"
                        : "border-transparent text-slate-500 hover:text-slate-200",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Decks tab ── */}
        {tab === "decks" && (
          <section className="px-6 py-8" style={{ background: "#0c0c14" }}>
            <div className="mx-auto max-w-5xl">
              {decksData && (
                <p className="mb-4 text-xs text-slate-500">
                  {decksData.data.length} / {decksData.limit} deck slots used
                </p>
              )}

              {decksLoading && <p className="text-sm text-slate-400">Loading…</p>}

              {!decksLoading && (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                  {decksData?.data.map((d) => <DeckTile key={d.id} deck={d} />)}
                  <button
                    onClick={openDeckDialog}
                    disabled={atCap}
                    title={atCap ? `Deck limit reached (${decksData?.limit})` : "New deck"}
                    className="group relative aspect-[5/7] rounded-xl border-2 border-dashed border-white/20 transition-colors hover:border-amber-500/40 hover:bg-white/[0.03] disabled:pointer-events-none disabled:opacity-40"
                  >
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                      <Plus className="h-7 w-7 text-white/25 transition-colors group-hover:text-amber-400/60" />
                      <span className="text-[11px] text-white/25 transition-colors group-hover:text-amber-400/60">New deck</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Collection tab ── */}
        {tab === "collection" && (
          <section className="px-6 py-8" style={{ background: "#09090f" }}>
            <div className="mx-auto max-w-5xl">

              <AddCardDialog
                open={showAdd}
                onOpenChange={setShowAdd}
                target={{ kind: "collection" }}
                onAdded={refreshCollection}
              />

              {/* Filter bar */}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter by name…"
                    className="h-9 w-52 rounded-md border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  />
                </div>

                <div className="flex gap-1">
                  {(["all", "in_decks", "for_sale", "unassigned"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={[
                        "h-9 rounded-md px-3 text-sm font-medium transition-colors",
                        filter === f
                          ? "bg-amber-500 text-black"
                          : "border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white",
                      ].join(" ")}
                    >
                      {f === "all" ? "All" : f === "in_decks" ? "In decks" : f === "for_sale" ? "For sale" : "Unassigned"}
                    </button>
                  ))}
                </div>

                <span className="text-sm text-slate-500">
                  {filteredItems.length.toLocaleString()} item{filteredItems.length === 1 ? "" : "s"}
                </span>

                <Button
                  onClick={() => setShowAdd(true)}
                  className="ml-auto bg-amber-500 text-black hover:bg-amber-400"
                >
                  Add card
                </Button>
              </div>

              {collectionLoading && <p className="text-sm text-slate-400">Loading…</p>}
              {collectionError && (
                <p className="text-sm text-red-400">{(collectionError as Error).message}</p>
              )}

              {collectionData && collectionData.items.length === 0 && (
                <p className="py-20 text-center text-slate-500">
                  Your collection is empty. Click{" "}
                  <button onClick={() => setShowAdd(true)} className="text-amber-400 hover:underline">
                    Add card
                  </button>{" "}
                  above to start tracking what you own.
                </p>
              )}

              {collectionData && collectionData.items.length > 0 && filteredItems.length === 0 && (
                <p className="py-20 text-center text-slate-500">No cards match the current filter.</p>
              )}

              <div className="space-y-2">
                {filteredItems.map((it) => (
                  <CollectionRow
                    key={it.id}
                    it={it}
                    onUpdateQty={(delta) => updateQty(it, it.quantity + delta)}
                    onSetCondition={(c) => setConditionVal(it, c)}
                    onRemove={() => removeCard(it.id)}
                    onRefresh={refreshCollection}
                  />
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Collection row
// ---------------------------------------------------------------------------

function CollectionRow({
  it,
  onUpdateQty,
  onSetCondition,
  onRemove,
  onRefresh,
}: {
  it: CollectionItem;
  onUpdateQty: (delta: number) => void;
  onSetCondition: (c: string) => void;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.05]">
      {/* Thumbnail */}
      <Link
        href={`/collection/items/${it.id}`}
        aria-label={`Open ${it.card_name}`}
        className="shrink-0 transition hover:opacity-80"
      >
        {it.image_uris?.small || it.image_uris?.normal ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={(it.image_uris.small as string) || (it.image_uris.normal as string)}
            alt={it.card_name}
            className="h-16 w-auto rounded shadow-md"
          />
        ) : (
          <div className="h-16 w-11 rounded bg-white/5" />
        )}
      </Link>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/collection/items/${it.id}`}
          className="font-medium text-white transition-colors hover:text-amber-300"
        >
          {it.card_name}
        </Link>
        <div className="mt-0.5 text-xs text-slate-500">
          {it.set_name}
          {it.set_code ? ` (${it.set_code.toUpperCase()})` : ""}
          {it.collector_number ? ` · #${it.collector_number}` : ""}
          {it.rarity ? ` · ${it.rarity}` : ""}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <ConditionBadge condition={it.card_condition} />
          <FinishBadge finish={it.finish} />
          <LangBadge lang={it.lang} />
          {it.in_listings.map((l) => (
            <Link
              key={`listing-${l.listing_id}`}
              href={`/store/listings/${l.listing_id}`}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 bg-emerald-900/50 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-900/70 hover:text-emerald-200 transition-colors"
            >
              for sale · {formatMoney(l.price_cents, l.currency)}
              {l.quantity > 1 ? ` ×${l.quantity}` : ""}
            </Link>
          ))}
        </div>
      </div>

      {/* Deck thumbnails */}
      {it.in_decks.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {it.in_decks.slice(0, 3).map((d, i) => (
            <MiniDeckTile
              key={`deck-${d.deck_id}-${d.zone}-${i}`}
              ref={d}
              className="h-12 w-auto"
            />
          ))}
          {it.in_decks.length > 3 && (
            <span className="text-xs text-slate-500">+{it.in_decks.length - 3}</span>
          )}
        </div>
      )}

      {/* Add to deck */}
      <div className="shrink-0">
        <AddToDeckButton
          collectionItemId={it.id}
          cardName={it.card_name}
          onAdded={onRefresh}
        />
      </div>

      {/* Qty stepper */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => onUpdateQty(-1)}
          className="h-8 w-8 rounded border border-white/10 bg-white/5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          −
        </button>
        <span className="min-w-[1.5rem] text-center text-sm tabular-nums text-white">
          {it.quantity}
        </span>
        <button
          onClick={() => onUpdateQty(1)}
          className="h-8 w-8 rounded border border-white/10 bg-white/5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          +
        </button>
      </div>

      {/* Condition select */}
      <select
        value={it.card_condition}
        onChange={(e) => onSetCondition(e.target.value)}
        className="h-8 shrink-0 rounded border border-white/10 bg-white/5 px-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
      >
        {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
      </select>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="shrink-0 rounded p-1 text-slate-600 transition-colors hover:text-red-400"
        title="Remove from collection"
      >
        ✕
      </button>
    </div>
  );
}
