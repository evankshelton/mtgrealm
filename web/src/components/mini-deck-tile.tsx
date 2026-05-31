import Link from "next/link";
import { cn, hashHue } from "@/lib/utils";
import type { DeckRef } from "@/lib/api";

// MiniDeckTile is the small (~64×90 px) sibling of DeckTile used inline
// inside collection rows: "this card is also in these decks".
//
// Same MTG 5:7 aspect ratio, commander art_crop background, but stripped
// down to just the deck name plus optional zone / quantity badges.
export function MiniDeckTile({
  ref,
  className,
}: {
  ref: DeckRef;
  className?: string;
}) {
  const hue = hashHue(ref.deck_id);
  const bg = ref.commander_art_url;
  const showZone = ref.zone && ref.zone !== "main";
  const showQty = ref.quantity > 1;

  const zoneLetter =
    ref.zone === "sideboard" ? "S"
    : ref.zone === "commander" ? "C"
    : ref.zone === "maybeboard" ? "M?"
    : ref.zone === "main" ? "" : ref.zone[0]?.toUpperCase() ?? "";

  return (
    <Link
      href={`/decks/${ref.deck_id}`}
      aria-label={`Open deck ${ref.deck_name}`}
      title={`${ref.deck_name}${ref.commander_name ? ` — ${ref.commander_name}` : ""}${
        showZone ? ` · ${ref.zone}` : ""
      }${showQty ? ` × ${ref.quantity}` : ""}`}
      className={cn(
        // Default sizing matches the main card thumbnail in the collection row
        // (h-20). Callers can override via className.
        "group relative block h-20 w-auto shrink-0 aspect-[5/7] overflow-hidden rounded-md border border-white/10 shadow-sm transition",
        "hover:-translate-y-0.5 hover:shadow-md hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {bg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bg}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, hsl(${hue}, 55%, 32%), hsl(${(hue + 50) % 360}, 65%, 18%))`,
          }}
        />
      )}

      {/* Bottom gradient for label legibility */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
      />

      {/* Top-right zone badge for non-main zones */}
      {zoneLetter && (
        <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase text-white backdrop-blur-sm">
          {zoneLetter}
        </span>
      )}

      {/* Bottom-right quantity badge */}
      {showQty && (
        <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[10px] font-semibold tabular-nums text-white">
          ×{ref.quantity}
        </span>
      )}

      {/* Deck name */}
      <div className="absolute inset-x-0 bottom-0 px-1 pb-1">
        <div className="truncate text-[10px] font-medium leading-tight text-white drop-shadow">
          {ref.deck_name}
        </div>
      </div>
    </Link>
  );
}
