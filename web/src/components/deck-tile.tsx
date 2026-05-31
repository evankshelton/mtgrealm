import Link from "next/link";
import { cn, hashHue } from "@/lib/utils";
import type { Deck } from "@/lib/api";

// MTG cards are 2.5"x3.5" — a 5:7 ratio. The tile mirrors that so a
// row of deck tiles reads visually like a row of cards. The commander's
// art_crop is rendered as the background; cropping it from a 1.37:1
// landscape rectangle to a 0.71:1 portrait gives every deck a unique
// vertical slice.
export function DeckTile({ deck, className }: { deck: Deck; className?: string }) {
  const bg = deck.commander_art_url;
  // Stable per-deck hue so commander-less tiles aren't all the same gray.
  const hue = hashHue(deck.id);

  return (
    <Link
      href={`/decks/${deck.id}`}
      aria-label={`Open deck ${deck.name}`}
      className={cn(
        "group relative block aspect-[5/7] overflow-hidden rounded-xl border shadow-sm transition",
        "hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {/* Background */}
      {bg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bg}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
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

      {/* Legibility gradient — dark at the bottom for text, lighter at the top for badges. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10"
      />
      {/* Subtle inner highlight for that "card edge" feel. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />

      {/* Content */}
      <div className="relative flex h-full flex-col justify-between p-3 text-white">
        <div className="flex items-start justify-between gap-2">
          {deck.format && (
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide backdrop-blur-sm">
              {deck.format}
            </span>
          )}
          {!deck.is_public && (
            <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] backdrop-blur-sm">
              private
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-lg font-semibold leading-tight drop-shadow-md">
            {deck.name}
          </div>
          {deck.commander_name && (
            <div className="text-xs text-white/80 drop-shadow">
              ⌬ {deck.commander_name}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-white/70">
            <span className="tabular-nums">{deck.card_count}</span>
            <span>cards</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

