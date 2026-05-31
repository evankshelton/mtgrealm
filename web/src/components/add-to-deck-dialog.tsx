"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, ZONES, type Deck } from "@/lib/api";
import { hashHue } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DeckListResp = { data: Deck[]; limit: number };

/**
 * AddToDeckButton renders a dashed, MTG-card-sized "+" tile that opens a
 * modal letting the user pick an existing deck to add this collection
 * item to. Designed to sit alongside MiniDeckTile in the collection row.
 */
export function AddToDeckButton({
  collectionItemId,
  cardName,
  onAdded,
}: {
  collectionItemId: string;
  cardName: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add this card to a deck"
        title="Add to a deck"
        className={
          "group flex h-20 w-auto aspect-[5/7] shrink-0 items-center justify-center " +
          "rounded-md border-2 border-dashed border-muted-foreground/40 " +
          "text-muted-foreground transition " +
          "hover:border-foreground/60 hover:bg-accent hover:text-foreground " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
      >
        <Plus className="h-5 w-5 transition-transform group-hover:scale-110" strokeWidth={2.5} />
      </button>

      <AddToDeckDialog
        open={open}
        onOpenChange={setOpen}
        collectionItemId={collectionItemId}
        cardName={cardName}
        onAdded={() => {
          onAdded();
          setOpen(false);
        }}
      />
    </>
  );
}

function AddToDeckDialog({
  open,
  onOpenChange,
  collectionItemId,
  cardName,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  collectionItemId: string;
  cardName: string;
  onAdded: () => void;
}) {
  const [zone, setZone] = useState<(typeof ZONES)[number]>("main");
  const [quantity, setQuantity] = useState(1);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decksQ = useQuery<DeckListResp>({
    queryKey: ["decks"],
    queryFn: () => api.get("/decks"),
    enabled: open,
  });

  async function pick(deckId: string) {
    setSubmittingId(deckId);
    setError(null);
    try {
      await api.post(`/decks/${deckId}/cards`, {
        collection_item_id: collectionItemId,
        zone,
        quantity,
      });
      onAdded();
    } catch (e) {
      setError((e as Error).message || "Could not add to deck");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add to a deck</DialogTitle>
          <DialogDescription>
            Pick a deck below to add <span className="font-medium">{cardName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 border-y py-3">
          <div className="space-y-1">
            <Label htmlFor="add-zone">Zone</Label>
            <select
              id="add-zone"
              value={zone}
              onChange={(e) => setZone(e.target.value as (typeof ZONES)[number])}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {ZONES.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-qty">Quantity</Label>
            <Input
              id="add-qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) =>
                setQuantity(Math.max(1, parseInt(e.target.value || "1", 10)))
              }
              className="w-24"
            />
          </div>
          <p className="ml-auto text-xs text-muted-foreground">
            Click a deck to add.
          </p>
        </div>

        {decksQ.isLoading && (
          <p className="text-sm text-muted-foreground">Loading decks…</p>
        )}
        {decksQ.error && (
          <p className="text-sm text-destructive">
            {(decksQ.error as Error).message}
          </p>
        )}
        {decksQ.data && decksQ.data.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            You don&apos;t have any decks yet. Create one from the Decks page.
          </p>
        )}
        {decksQ.data && decksQ.data.data.length > 0 && (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
            {decksQ.data.data.map((d) => (
              <DeckChoice
                key={d.id}
                deck={d}
                disabled={submittingId !== null}
                submitting={submittingId === d.id}
                onClick={() => pick(d.id)}
              />
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function DeckChoice({
  deck,
  onClick,
  disabled,
  submitting,
}: {
  deck: Deck;
  onClick: () => void;
  disabled: boolean;
  submitting: boolean;
}) {
  const hue = hashHue(deck.id);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        deck.commander_name
          ? `${deck.name} — ${deck.commander_name}`
          : deck.name
      }
      className={
        "group relative aspect-[5/7] overflow-hidden rounded-md border shadow-sm transition " +
        "hover:-translate-y-0.5 hover:shadow-md " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        "disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {deck.commander_art_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={deck.commander_art_url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, hsl(${hue}, 55%, 32%), hsl(${(hue + 50) % 360}, 65%, 18%))`,
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-2 text-left text-white">
        <div className="truncate text-sm font-semibold drop-shadow">
          {deck.name}
        </div>
        {deck.format && (
          <div className="truncate text-[10px] uppercase tracking-wide text-white/70">
            {deck.format}
          </div>
        )}
      </div>
      {submitting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white">
          Adding…
        </div>
      )}
    </button>
  );
}
