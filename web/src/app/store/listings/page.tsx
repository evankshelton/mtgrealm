"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const darkInp = "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50";

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

  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MarketplaceListing | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [qtys, setQtys] = useState<Record<string, number>>({});

  if (loading || !user) return null;
  if (listingsQ.isLoading) return <p className="text-slate-400">Loading…</p>;

  const listings = listingsQ.data?.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["store-listings"] });

  async function updateStatus(id: string, status: string) {
    await api.patch(`/store/listings/${id}`, { status });
    refresh();
  }

  function getQty(l: MarketplaceListing) {
    return qtys[l.id] ?? l.quantity;
  }

  async function adjustQty(l: MarketplaceListing, delta: number) {
    const next = Math.max(0, getQty(l) + delta);
    setQtys((prev) => ({ ...prev, [l.id]: next }));
    await api.patch(`/store/listings/${l.id}`, { quantity: next });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    await api.del(`/store/listings/${deleteTarget.id}`);
    refresh();
    setDeleting(false);
    setDeleteTarget(null);
  }

  const listedCardIds = new Set(
    listings.filter((l) => l.status !== "delisted").map((l) => l.card_id),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold text-white">Your listings</h1>
        <Button onClick={() => setOpen(true)} className="bg-amber-500 text-black hover:bg-amber-400">
          New listing
        </Button>
      </div>

      {listings.length === 0 && <p className="text-slate-400">No listings yet.</p>}

      <div className="space-y-2">
        {listings.map((l) => (
          <div key={l.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            {l.image_uris?.small || l.image_uris?.normal ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.image_uris.small || l.image_uris.normal}
                alt={l.card_name}
                className="h-16 w-auto rounded"
              />
            ) : (
              <div className="h-16 w-12 rounded bg-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{l.card_name}</div>
              <div className="mt-1 text-xs text-slate-400">{l.set_name}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <ConditionBadge condition={l.card_condition} />
                <FinishBadge finish={l.finish} />
                <LangBadge lang={l.lang} />
              </div>
              <div className="mt-1.5 text-xs font-medium text-slate-300">{formatMoney(l.price_cents, l.currency)}</div>
            </div>
            {/* Qty stepper */}
            <div className="flex h-9 items-center rounded-md border border-white/10 bg-white/5">
              <button
                onClick={() => adjustQty(l, -1)}
                disabled={getQty(l) <= 0}
                className="flex h-full w-8 items-center justify-center text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[2rem] text-center text-sm tabular-nums text-white">
                {getQty(l)}
              </span>
              <button
                onClick={() => adjustQty(l, 1)}
                className="flex h-full w-8 items-center justify-center text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <select
              value={l.status}
              onChange={(e) => updateStatus(l.id, e.target.value)}
              className="h-9 rounded-md border border-white/10 bg-white/5 px-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="sold_out">sold_out</option>
              <option value="delisted">delisted</option>
            </select>
            <Button variant="ghost" size="icon" asChild className="text-slate-400 hover:text-white">
              <Link href={`/store/listings/${l.id}`}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-destructive"
              onClick={() => setDeleteTarget(l)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl bg-[#0d0d1a] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">List a card from your collection</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CreateListing
              listedCardIds={listedCardIds}
              onCreated={() => { refresh(); setOpen(false); }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm bg-[#0d0d1a] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Delete listing?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-400">
            <span className="font-medium text-white">{deleteTarget?.card_name}</span>
            {deleteTarget && ` — ${deleteTarget.card_condition} · ${deleteTarget.finish}`}
            <br />
            This will permanently remove the listing from your store. This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const CONDITION_STYLES: Record<string, string> = {
  NM:  "bg-emerald-900/40 text-emerald-400",
  LP:  "bg-blue-900/40 text-blue-400",
  MP:  "bg-yellow-900/40 text-yellow-400",
  HP:  "bg-orange-900/40 text-orange-400",
  DMG: "bg-red-900/40 text-red-400",
};

function ConditionBadge({ condition }: { condition: string }) {
  const cls = CONDITION_STYLES[condition.toUpperCase()] ?? "bg-white/5 text-slate-400";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {condition}
    </span>
  );
}

function FinishBadge({ finish }: { finish: string }) {
  const foil = finish !== "nonfoil";
  return (
    <span
      className={[
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        foil ? "bg-purple-900/40 text-purple-400" : "bg-white/5 text-slate-400",
      ].join(" ")}
    >
      {finish === "nonfoil" ? "Non-foil" : finish === "foil" ? "Foil" : finish}
    </span>
  );
}

function LangBadge({ lang }: { lang: string }) {
  const isEnglish = lang.toLowerCase() === "en";
  return (
    <span
      className={[
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        isEnglish ? "bg-white/5 text-slate-400" : "bg-amber-900/40 text-amber-400",
      ].join(" ")}
    >
      {lang.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------

function CreateListing({
  listedCardIds,
  onCreated,
}: {
  listedCardIds: Set<string>;
  onCreated: () => void;
}) {
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
    const available = data.items.filter((it) => !listedCardIds.has(it.card_id));
    if (!filter) return available.slice(0, 40);
    const q = filter.toLowerCase();
    return available.filter((it) => it.card_name.toLowerCase().includes(q)).slice(0, 40);
  }, [data, filter, listedCardIds]);

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

  if (!picked) {
    return (
      <div className="space-y-3 px-1 pb-1 pt-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search your collection…"
          autoFocus
          className={darkInp}
        />
        {isLoading && <p className="text-sm text-slate-400">Loading collection…</p>}
        {!isLoading && data && filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">
            {data.items.length === 0
              ? "Your collection is empty."
              : filter
              ? "No matches in your collection."
              : "All cards in your collection already have listings."}
          </p>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.map((it) => (
            <button
              key={it.id}
              onClick={() => { setPicked(it); setQty(1); setPriceDollars(""); setDesc(""); setErr(null); }}
              className="flex items-center gap-3 rounded-md border border-white/10 bg-white/5 p-2 text-left transition-colors hover:bg-white/10"
            >
              {it.image_uris?.small || it.image_uris?.normal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(it.image_uris.small as string) || (it.image_uris.normal as string)}
                  alt={it.card_name}
                  className="h-14 w-auto rounded"
                />
              ) : (
                <div className="h-14 w-10 rounded bg-white/10" />
              )}
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium text-white">{it.card_name}</div>
                <div className="truncate text-xs text-slate-400">
                  {it.set_name} ({it.set_code?.toUpperCase()})
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <ConditionBadge condition={it.card_condition} />
                  <FinishBadge finish={it.finish} />
                  <LangBadge lang={it.lang} />
                </div>
                <div className="mt-1 text-xs text-slate-400">Own: {it.quantity}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-1 pb-1 pt-2">
      <div className="flex gap-4">
        {picked.image_uris?.normal && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picked.image_uris.normal as string}
            alt={picked.card_name}
            className="h-36 w-auto rounded shadow-sm"
          />
        )}
        <div className="text-sm">
          <div className="text-base font-semibold text-white">{picked.card_name}</div>
          <div className="text-slate-400">
            {picked.set_name} ({picked.set_code?.toUpperCase()})
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <ConditionBadge condition={picked.card_condition} />
            <FinishBadge finish={picked.finish} />
            <LangBadge lang={picked.lang} />
          </div>
          <div className="mt-1.5 text-slate-400">You own {picked.quantity}.</div>
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto px-0 py-0 text-xs text-amber-400 hover:text-amber-300"
            onClick={() => setPicked(null)}
          >
            ← Pick a different card
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-qty" className="text-slate-300">Quantity to list</Label>
          <Input
            id="new-qty"
            type="number"
            min={1}
            max={picked.quantity}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(picked.quantity, parseInt(e.target.value || "1", 10))))}
            className={darkInp}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-price" className="text-slate-300">Price each ($)</Label>
          <Input
            id="new-price"
            type="number"
            step="0.01"
            min="0.01"
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
            className={darkInp}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-desc" className="text-slate-300">Description (optional)</Label>
        <Input
          id="new-desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Condition notes, anything buyers should know"
          className={darkInp}
        />
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button onClick={submit} disabled={submitting} className="bg-amber-500 text-black hover:bg-amber-400">
        {submitting ? "Creating…" : "Create listing"}
      </Button>
    </div>
  );
}
