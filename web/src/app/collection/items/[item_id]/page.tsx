"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  CONDITIONS,
  FINISHES,
  type CardPrint,
  type CollectionItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AddToDeckButton } from "@/components/add-to-deck-dialog";
import { ManaCost } from "@/components/mana-cost";
import { MiniDeckTile } from "@/components/mini-deck-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const darkInp = "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50";
const darkSel = "h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50";

export default function CollectionItemPage({
  params,
}: {
  params: Promise<{ item_id: string }>;
}) {
  const { item_id } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const itemQ = useQuery<CollectionItem>({
    queryKey: ["collection-item", item_id],
    queryFn: () => api.get<CollectionItem>(`/collection/items/${item_id}`),
    enabled: !!user,
  });

  const item = itemQ.data;

  const cardQ = useQuery<CardPrint>({
    queryKey: ["card-print", item?.card_id],
    queryFn: () => api.get<CardPrint>(`/cards/${item!.card_id}`),
    enabled: !!item,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["collection-item", item_id] });
    qc.invalidateQueries({ queryKey: ["collection"] });
  };

  if (loading || !user) return null;
  if (itemQ.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (itemQ.error) {
    const e = itemQ.error as Error & { status?: number };
    if (e.status === 404) {
      return (
        <div className="space-y-3">
          <p className="text-slate-400">That card is no longer in your collection.</p>
          <Button asChild variant="outline" className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">
            <Link href="/collection">← Back to collection</Link>
          </Button>
        </div>
      );
    }
    return <p className="text-destructive">{e.message}</p>;
  }
  if (!item) return null;

  return (
    <div className="space-y-6">
      <Link
        href="/collection"
        className="inline-block text-sm text-slate-400 hover:text-white hover:underline"
      >
        ← Back to collection
      </Link>

      <div className="grid gap-6 md:grid-cols-[minmax(240px,320px)_1fr]">
        <ImageColumn item={item} card={cardQ.data} />
        <InfoColumn
          item={item}
          card={cardQ.data}
          isCardLoading={cardQ.isLoading}
          onChanged={refresh}
        />
      </div>

      <DecksSection item={item} onChanged={refresh} />
      {item.in_listings.length > 0 && <ListingsSection item={item} />}
      <AcquiredAndNotes item={item} onChanged={refresh} />
      <DangerZone item={item} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left column: image
// ---------------------------------------------------------------------------

function ImageColumn({ item, card }: { item: CollectionItem; card?: CardPrint }) {
  const src =
    card?.image_uris?.large ||
    card?.image_uris?.normal ||
    (item.image_uris?.large as string | undefined) ||
    (item.image_uris?.normal as string | undefined);

  if (!src) {
    return <div className="aspect-[5/7] rounded-lg bg-white/10" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={item.card_name} className="w-full rounded-lg shadow" />
  );
}

// ---------------------------------------------------------------------------
// Right column: name, type, oracle text, quick manage controls
// ---------------------------------------------------------------------------

function InfoColumn({
  item,
  card,
  isCardLoading,
  onChanged,
}: {
  item: CollectionItem;
  card?: CardPrint;
  isCardLoading: boolean;
  onChanged: () => void;
}) {
  async function patch(body: object) {
    await api.patch(`/collection/items/${item.id}`, body);
    onChanged();
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-white">{item.card_name}</h1>
        <p className="text-sm text-slate-400">
          {item.type_line}
          {card?.mana_cost && <> · <ManaCost cost={card.mana_cost} /></>}
          {typeof card?.cmc === "number" ? ` · CMC ${card.cmc}` : ""}
        </p>
        <p className="text-sm text-slate-400">
          {item.set_name} ({item.set_code?.toUpperCase()}) · #{item.collector_number}
          {" · "}
          {item.rarity}
          {" · "}
          {item.lang}
        </p>
      </header>

      {/* Manage tools */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/8 px-4 py-3">
          <div className="text-base font-medium text-white">In your collection</div>
        </div>
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1">
            <Label className="text-slate-300">Quantity</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={item.quantity <= 0}
                onClick={() => patch({ quantity: item.quantity - 1 })}
                className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                −
              </Button>
              <span className="min-w-10 text-center text-lg font-medium tabular-nums text-white">
                {item.quantity}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ quantity: item.quantity + 1 })}
                className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                +
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="finish" className="text-slate-300">Finish</Label>
            <select
              id="finish"
              value={item.finish}
              onChange={(e) => patch({ finish: e.target.value })}
              className={darkSel}
            >
              {FINISHES.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cond" className="text-slate-300">Condition</Label>
            <select
              id="cond"
              value={item.card_condition}
              onChange={(e) => patch({ card_condition: e.target.value })}
              className={darkSel}
            >
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Oracle text / flavor / artist */}
      {isCardLoading && (
        <p className="text-sm text-slate-400">Loading card details…</p>
      )}
      {card && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          {card.oracle_text && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
              {card.oracle_text}
            </p>
          )}
          {(card.power || card.toughness || card.loyalty) && (
            <p className="text-sm font-medium text-white">
              {card.power && card.toughness ? `${card.power} / ${card.toughness}` : null}
              {card.loyalty ? `Loyalty: ${card.loyalty}` : null}
            </p>
          )}
          {card.flavor_text && (
            <p className="border-t border-white/10 pt-3 text-sm italic text-slate-400">
              {card.flavor_text}
            </p>
          )}
          <p className="text-xs text-slate-500">
            {card.artist ? `Illustrated by ${card.artist}` : null}
            {card.released_at ? ` · ${card.released_at}` : null}
          </p>
          {card.prices && hasPrice(card.prices) && (
            <p className="text-xs text-slate-500">
              Market: {formatPrices(card.prices)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decks section
// ---------------------------------------------------------------------------

function DecksSection({
  item,
  onChanged,
}: {
  item: CollectionItem;
  onChanged: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">In decks</div>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <AddToDeckButton
            collectionItemId={item.id}
            cardName={item.card_name}
            onAdded={onChanged}
          />
          {item.in_decks.length === 0 ? (
            <p className="text-sm text-slate-400">
              Not in any deck yet — click the dashed card to assign it.
            </p>
          ) : (
            item.in_decks.map((d, i) => (
              <MiniDeckTile
                key={`${d.deck_id}-${d.zone}-${i}`}
                ref={d}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Listings section
// ---------------------------------------------------------------------------

function ListingsSection({ item }: { item: CollectionItem }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">For sale</div>
      </div>
      <div className="space-y-2 p-4">
        {item.in_listings.map((l) => (
          <div
            key={l.listing_id}
            className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            <span className="text-slate-300">
              {l.quantity}× listed at <strong className="text-white">{formatMoney(l.price_cents, l.currency)}</strong>
            </span>
            <span className="text-xs text-slate-500">{l.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acquired info + notes
// ---------------------------------------------------------------------------

function AcquiredAndNotes({
  item,
  onChanged,
}: {
  item: CollectionItem;
  onChanged: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [acquiredAt, setAcquiredAt] = useState(item.acquired_at ?? "");
  const [acquiredPrice, setAcquiredPrice] = useState(
    item.acquired_price_cents != null
      ? (item.acquired_price_cents / 100).toFixed(2)
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    notes !== (item.notes ?? "") ||
    acquiredAt !== (item.acquired_at ?? "") ||
    acquiredPrice !==
      (item.acquired_price_cents != null
        ? (item.acquired_price_cents / 100).toFixed(2)
        : "");

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/collection/items/${item.id}`, {
        notes: notes,
        acquired_at: acquiredAt,
        acquired_price_cents:
          acquiredPrice.trim() === ""
            ? null
            : Math.round(parseFloat(acquiredPrice) * 100),
      });
      setSavedAt(Date.now());
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">Notes &amp; acquisition</div>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_140px]">
          <div className="space-y-1">
            <Label htmlFor="notes" className="text-slate-300">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. signed copy, pulled from prerelease"
              className={darkInp}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acq-at" className="text-slate-300">Acquired on</Label>
            <Input
              id="acq-at"
              type="date"
              value={acquiredAt || ""}
              onChange={(e) => setAcquiredAt(e.target.value)}
              className={darkInp}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acq-price" className="text-slate-300">Price</Label>
            <Input
              id="acq-price"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={acquiredPrice}
              onChange={(e) => setAcquiredPrice(e.target.value)}
              className={darkInp}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={save}
            disabled={!dirty || saving}
            className="bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {savedAt && !dirty && (
            <span className="text-xs text-slate-500">Saved.</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

function DangerZone({ item }: { item: CollectionItem }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (
      !confirm(
        `Remove all ${item.quantity}× ${item.card_name} (${item.finish}, ${item.card_condition}, ${item.lang}) from your collection? This will also remove it from any decks that reference it.`,
      )
    )
      return;
    setRemoving(true);
    try {
      await api.del(`/collection/items/${item.id}`);
      qc.invalidateQueries({ queryKey: ["collection"] });
      router.push("/collection");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-center justify-between">
      <div className="text-sm">
        <div className="font-medium text-destructive">Remove from collection</div>
        <p className="text-slate-400">
          Deletes this entry and removes it from any decks that reference it.
        </p>
      </div>
      <Button variant="destructive" onClick={remove} disabled={removing}>
        {removing ? "Removing…" : "Remove"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasPrice(p: Record<string, string | null>): boolean {
  return Object.values(p).some((v) => v != null && v !== "");
}

function formatPrices(p: Record<string, string | null>): string {
  const parts: string[] = [];
  if (p.usd) parts.push(`$${p.usd}`);
  if (p.usd_foil) parts.push(`$${p.usd_foil} (foil)`);
  if (p.usd_etched) parts.push(`$${p.usd_etched} (etched)`);
  if (p.eur) parts.push(`€${p.eur}`);
  return parts.join(" · ") || "—";
}

function formatMoney(cents: number, currency: string): string {
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
