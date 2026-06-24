"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  CONDITIONS,
  FINISHES,
  ZONES,
  type CanonicalCard,
  type CardPrint,
  type CollectionDetail,
  type CollectionItem,
  type SearchResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type Target =
  | { kind: "collection" }
  | { kind: "deck"; deckId: string };

const darkInp = "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50";
const darkSel = "h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50";

// ---------------------------------------------------------------------------
// Public: dialog wrapper
// ---------------------------------------------------------------------------

export function AddCardDialog({
  open,
  onOpenChange,
  target,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: Target;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<"from-collection" | "search">(
    target.kind === "deck" ? "from-collection" : "search",
  );

  function handleAdded() {
    onAdded();
    onOpenChange(false);
  }

  const tabBtn = (active: boolean) =>
    [
      "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
      active
        ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
        : "border-white/10 text-slate-400 hover:border-white/30 hover:text-white",
    ].join(" ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl bg-[#0d0d1a] border-white/10">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
          <DialogTitle className="text-white">
            Add card to {target.kind === "deck" ? "deck" : "collection"}
          </DialogTitle>
          {target.kind === "deck" && (
            <div className="flex shrink-0 gap-1">
              <button onClick={() => setMode("from-collection")} className={tabBtn(mode === "from-collection")}>
                From collection
              </button>
              <button onClick={() => setMode("search")} className={tabBtn(mode === "search")}>
                Add new
              </button>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-6 space-y-4">
          {mode === "from-collection" && target.kind === "deck" ? (
            <FromCollectionFlow deckId={target.deckId} onAdded={handleAdded} />
          ) : (
            <SearchFlow target={target} onAdded={handleAdded} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pick from your collection (deck target only)
// ---------------------------------------------------------------------------

function FromCollectionFlow({
  deckId,
  onAdded,
}: {
  deckId: string;
  onAdded: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<CollectionItem | null>(null);

  const { data, isLoading } = useQuery<CollectionDetail>({
    queryKey: ["collection"],
    queryFn: () => api.get("/collection"),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!filter) return data.items;
    const q = filter.toLowerCase();
    return data.items.filter((it) => it.card_name.toLowerCase().includes(q));
  }, [data, filter]);

  if (picked) {
    return (
      <DeckEntryForm
        deckId={deckId}
        mode="from-collection"
        item={picked}
        onCancel={() => setPicked(null)}
        onAdded={() => {
          onAdded();
          setPicked(null);
        }}
      />
    );
  }

  if (isLoading) return <p className="text-sm text-slate-400">Loading collection…</p>;
  if (!data || data.items.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Your collection is empty. Switch to <em>Add new</em> to add a card to both your collection
        and this deck.
      </p>
    );
  }

  return (
    <>
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter your collection by name…"
        className={darkInp}
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No cards match.</p>
      ) : (
        <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {filtered.map((it) => (
            <button
              key={it.id}
              onClick={() => setPicked(it)}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-left transition-colors hover:bg-white/5"
            >
              {it.image_uris?.small || it.image_uris?.normal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(it.image_uris.small as string) || (it.image_uris.normal as string)}
                  alt={it.card_name}
                  className="h-16 w-auto rounded"
                />
              ) : (
                <div className="h-16 w-12 rounded bg-white/10" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{it.card_name}</span>
                  {it.finish !== "nonfoil" && (
                    <span className="rounded bg-purple-900/40 px-1 py-0.5 text-[10px] text-purple-300">
                      {it.finish}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-400">
                  {it.set_name} ({it.set_code?.toUpperCase()}) #{it.collector_number} ·{" "}
                  {it.card_condition} · {it.lang} · own {it.quantity}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Search a card (collection target, or deck "Add new" tab)
// ---------------------------------------------------------------------------

function SearchFlow({
  target,
  onAdded,
}: {
  target: Target;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [chosenCanonical, setChosenCanonical] = useState<CanonicalCard | null>(null);
  const [chosenPrint, setChosenPrint] = useState<CardPrint | null>(null);

  const searchQ = useQuery<SearchResponse>({
    queryKey: ["add-search", submitted],
    queryFn: () => {
      const params = new URLSearchParams({ q: submitted, limit: "12" });
      return api.get<SearchResponse>(`/cards/search?${params}`);
    },
    enabled: submitted.length > 0,
  });

  const printsQ = useQuery<{ oracle_id: string; prints: CardPrint[] }>({
    queryKey: ["add-prints", chosenCanonical?.oracle_id],
    queryFn: () => api.get(`/cards/oracle/${chosenCanonical!.oracle_id}/prints`),
    enabled: !!chosenCanonical,
  });

  function reset() {
    setQ("");
    setSubmitted("");
    setChosenCanonical(null);
    setChosenPrint(null);
  }

  if (chosenCanonical && chosenPrint) {
    if (target.kind === "collection") {
      return (
        <CollectionAddForm
          card={chosenPrint}
          onCancel={() => setChosenPrint(null)}
          onAdded={() => { onAdded(); reset(); }}
        />
      );
    }
    return (
      <DeckEntryForm
        deckId={target.deckId}
        mode="new-card"
        print={chosenPrint}
        onCancel={() => setChosenPrint(null)}
        onAdded={() => { onAdded(); reset(); }}
      />
    );
  }

  if (chosenCanonical) {
    return (
      <>
        <div className="flex items-center gap-3">
          {chosenCanonical.image_uris?.normal && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={chosenCanonical.image_uris.normal}
              alt={chosenCanonical.name}
              className="h-24 w-auto rounded"
            />
          )}
          <div>
            <div className="font-medium text-white">{chosenCanonical.name}</div>
            <div className="text-xs text-slate-400">{chosenCanonical.type_line}</div>
            <button
              onClick={() => setChosenCanonical(null)}
              className="mt-1 text-sm text-amber-400 hover:text-amber-300"
            >
              ← Pick a different card
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-400">Pick a printing:</p>
        {printsQ.isLoading && <p className="text-sm text-slate-400">Loading printings…</p>}
        {printsQ.data && (
          <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {printsQ.data.prints.map((p) => (
              <button
                key={p.id}
                onClick={() => setChosenPrint(p)}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-left transition-colors hover:bg-white/5"
              >
                {p.image_uris?.small || p.image_uris?.normal ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_uris?.small || p.image_uris?.normal}
                    alt={p.name}
                    className="h-16 w-auto rounded"
                  />
                ) : (
                  <div className="h-16 w-12 rounded bg-white/10" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">
                    {p.set_name} ({p.set_code?.toUpperCase()})
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    #{p.collector_number} · {p.rarity} · {p.released_at} · {p.lang}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search card name…" className={darkInp} />
        <Button type="submit" className="bg-amber-500 text-black hover:bg-amber-400">Search</Button>
      </form>
      {searchQ.isFetching && <p className="text-sm text-slate-400">Searching…</p>}
      {searchQ.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {searchQ.data.data.map((c) => (
            <button
              key={c.oracle_id}
              className="text-left transition hover:opacity-80"
              onClick={() => setChosenCanonical(c)}
            >
              {c.image_uris?.normal || c.image_uris?.large ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.image_uris.normal || c.image_uris.large}
                  alt={c.name}
                  className="aspect-[488/680] w-full rounded"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-[488/680] w-full rounded bg-white/10" />
              )}
              <div className="mt-1 truncate text-sm font-medium text-white">{c.name}</div>
              <div className="truncate text-xs text-slate-400">{c.type_line ?? ""}</div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function CollectionAddForm({
  card,
  onCancel,
  onAdded,
}: {
  card: CardPrint;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState<(typeof FINISHES)[number]>(
    card.foil && !card.nonfoil ? "foil" : "nonfoil",
  );
  const [cardCondition, setCondition] = useState<(typeof CONDITIONS)[number]>("NM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/collection/items`, {
        card_id: card.id,
        finish,
        card_condition: cardCondition,
        lang: card.lang,
        quantity,
      });
      onAdded();
    } catch (e) {
      setError((e as Error).message || "Add failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <PrintPreview card={card} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <QtyField value={quantity} onChange={setQuantity} />
        <SelectField label="Finish" id="finish" value={finish} onChange={(v) => setFinish(v as any)} options={FINISHES} />
        <SelectField label="Condition" id="cond" value={cardCondition} onChange={(v) => setCondition(v as any)} options={CONDITIONS} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={submitting} className="bg-amber-500 text-black hover:bg-amber-400">
          {submitting ? "Adding…" : "Add to collection"}
        </Button>
        <Button variant="outline" onClick={onCancel} className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">
          Back
        </Button>
      </div>
    </div>
  );
}

function DeckEntryForm(
  props:
    | {
        deckId: string;
        mode: "from-collection";
        item: CollectionItem;
        onCancel: () => void;
        onAdded: () => void;
      }
    | {
        deckId: string;
        mode: "new-card";
        print: CardPrint;
        onCancel: () => void;
        onAdded: () => void;
      },
) {
  const [quantity, setQuantity] = useState(1);
  const [zone, setZone] = useState<(typeof ZONES)[number]>("main");
  const [finish, setFinish] = useState<(typeof FINISHES)[number]>("nonfoil");
  const [cardCondition, setCondition] = useState<(typeof CONDITIONS)[number]>("NM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      if (props.mode === "from-collection") {
        await api.post(`/decks/${props.deckId}/cards`, {
          collection_item_id: props.item.id,
          zone,
          quantity,
        });
      } else {
        await api.post(`/decks/${props.deckId}/cards`, {
          card_id: props.print.id,
          finish,
          card_condition: cardCondition,
          lang: props.print.lang,
          zone,
          quantity,
        });
      }
      props.onAdded();
    } catch (e) {
      setError((e as Error).message || "Add failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {props.mode === "from-collection" ? (
        <ItemPreview item={props.item} />
      ) : (
        <PrintPreview card={props.print} />
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QtyField value={quantity} onChange={setQuantity} />
        <SelectField label="Zone" id="zone" value={zone} onChange={(v) => setZone(v as any)} options={ZONES} />
        {props.mode === "new-card" && (
          <>
            <SelectField label="Finish" id="finish" value={finish} onChange={(v) => setFinish(v as any)} options={FINISHES} />
            <SelectField label="Condition" id="cond" value={cardCondition} onChange={(v) => setCondition(v as any)} options={CONDITIONS} />
          </>
        )}
      </div>
      {props.mode === "new-card" && (
        <p className="text-xs text-slate-500">
          This will also add the card to your collection.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={submitting} className="bg-amber-500 text-black hover:bg-amber-400">
          {submitting ? "Adding…" : "Add to deck"}
        </Button>
        <Button variant="outline" onClick={props.onCancel} className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">
          Back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small leaf components
// ---------------------------------------------------------------------------

function PrintPreview({ card }: { card: CardPrint }) {
  return (
    <div className="flex gap-3">
      {card.image_uris?.normal && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.image_uris.normal} alt={card.name} className="h-40 w-auto rounded" />
      )}
      <div className="text-sm">
        <div className="font-medium text-white">{card.name}</div>
        <div className="text-slate-400">
          {card.set_name} ({card.set_code?.toUpperCase()}) · #{card.collector_number}
        </div>
        <div className="text-slate-400">
          {card.rarity} · {card.lang} · {card.released_at}
        </div>
      </div>
    </div>
  );
}

function ItemPreview({ item }: { item: CollectionItem }) {
  return (
    <div className="flex gap-3">
      {item.image_uris?.normal && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_uris.normal as string} alt={item.card_name} className="h-40 w-auto rounded" />
      )}
      <div className="text-sm">
        <div className="font-medium text-white">{item.card_name}</div>
        <div className="text-slate-400">
          {item.set_name} ({item.set_code?.toUpperCase()}) · #{item.collector_number}
        </div>
        <div className="text-slate-400">
          {item.finish} · {item.card_condition} · {item.lang} · you own {item.quantity}
        </div>
      </div>
    </div>
  );
}

function QtyField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor="qty" className="text-slate-300">Quantity</Label>
      <Input
        id="qty"
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, parseInt(e.target.value || "1", 10)))}
        className={darkInp}
      />
    </div>
  );
}

function SelectField({
  label,
  id,
  value,
  onChange,
  options,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-slate-300">{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={darkSel}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
