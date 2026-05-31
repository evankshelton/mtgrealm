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
import { MiniDeckTile } from "@/components/mini-deck-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
  if (itemQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (itemQ.error) {
    const e = itemQ.error as Error & { status?: number };
    if (e.status === 404) {
      return (
        <div className="space-y-3">
          <p className="text-muted-foreground">That card is no longer in your collection.</p>
          <Button asChild variant="outline">
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
        className="inline-block text-sm text-muted-foreground hover:underline"
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
    return <div className="aspect-[5/7] rounded-lg bg-muted" />;
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
        <h1 className="text-3xl font-semibold tracking-tight">{item.card_name}</h1>
        <p className="text-sm text-muted-foreground">
          {item.type_line}
          {card?.mana_cost ? ` · ${card.mana_cost}` : ""}
          {typeof card?.cmc === "number" ? ` · CMC ${card.cmc}` : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          {item.set_name} ({item.set_code?.toUpperCase()}) · #{item.collector_number}
          {" · "}
          {item.rarity}
          {" · "}
          {item.lang}
        </p>
        {item.oracle_id && (
          <p className="text-xs">
            <Link
              href={`/cards/${item.oracle_id}`}
              className="text-muted-foreground hover:underline"
            >
              See all printings →
            </Link>
          </p>
        )}
      </header>

      {/* Manage tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">In your collection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>Quantity</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={item.quantity <= 0}
                onClick={() => patch({ quantity: item.quantity - 1 })}
              >
                −
              </Button>
              <span className="min-w-10 text-center text-lg font-medium tabular-nums">
                {item.quantity}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ quantity: item.quantity + 1 })}
              >
                +
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="finish">Finish</Label>
            <select
              id="finish"
              value={item.finish}
              onChange={(e) => patch({ finish: e.target.value })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {FINISHES.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cond">Condition</Label>
            <select
              id="cond"
              value={item.card_condition}
              onChange={(e) => patch({ card_condition: e.target.value })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Oracle text / flavor / artist */}
      {isCardLoading && (
        <p className="text-sm text-muted-foreground">Loading card details…</p>
      )}
      {card && (
        <div className="space-y-3 rounded-lg border p-4">
          {card.oracle_text && (
            <p className="whitespace-pre-line text-sm leading-relaxed">
              {card.oracle_text}
            </p>
          )}
          {(card.power || card.toughness || card.loyalty) && (
            <p className="text-sm font-medium">
              {card.power && card.toughness ? `${card.power} / ${card.toughness}` : null}
              {card.loyalty ? `Loyalty: ${card.loyalty}` : null}
            </p>
          )}
          {card.flavor_text && (
            <p className="border-t pt-3 text-sm italic text-muted-foreground">
              {card.flavor_text}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {card.artist ? `Illustrated by ${card.artist}` : null}
            {card.released_at ? ` · ${card.released_at}` : null}
          </p>
          {card.prices && hasPrice(card.prices) && (
            <p className="text-xs text-muted-foreground">
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">In decks</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <AddToDeckButton
            collectionItemId={item.id}
            cardName={item.card_name}
            onAdded={onChanged}
          />
          {item.in_decks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Listings section
// ---------------------------------------------------------------------------

function ListingsSection({ item }: { item: CollectionItem }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">For sale</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {item.in_listings.map((l) => (
          <div
            key={l.listing_id}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <span>
              {l.quantity}× listed at <strong>{formatMoney(l.price_cents, l.currency)}</strong>
            </span>
            <span className="text-xs text-muted-foreground">{l.status}</span>
          </div>
        ))}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Notes &amp; acquisition</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_140px]">
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. signed copy, pulled from prerelease"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acq-at">Acquired on</Label>
            <Input
              id="acq-at"
              type="date"
              value={acquiredAt || ""}
              onChange={(e) => setAcquiredAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acq-price">Price</Label>
            <Input
              id="acq-price"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={acquiredPrice}
              onChange={(e) => setAcquiredPrice(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {savedAt && !dirty && (
            <span className="text-xs text-muted-foreground">Saved.</span>
          )}
        </div>
      </CardContent>
    </Card>
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
        <p className="text-muted-foreground">
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
