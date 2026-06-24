// Parses "{2}{W}{U}" → ["2", "W", "U"]
function parseMana(cost: string): string[] {
  return Array.from(cost.matchAll(/\{([^}]+)\}/g)).map((m) => m[1]);
}

// MTG accurate mana colors
const BASE_COLORS: Record<string, { bg: string; fg: string }> = {
  W: { bg: "#f8f6dc", fg: "#332200" },
  U: { bg: "#0e68ab", fg: "#ffffff" },
  B: { bg: "#2d1f33", fg: "#e0d0e8" },
  R: { bg: "#d3202a", fg: "#ffffff" },
  G: { bg: "#005e26", fg: "#ffffff" },
  C: { bg: "#9cc1c3", fg: "#1a2a2a" },
  S: { bg: "#c6d9e6", fg: "#1a2a2a" },
};

const GENERIC: { bg: string; fg: string } = { bg: "#b8b2ab", fg: "#1a1a1a" };

function getStyle(sym: string): { background: string; color: string } {
  const upper = sym.toUpperCase();

  // Generic number or X/Y/Z/T/Q
  if (/^\d+$/.test(upper) || /^[XYZTQ]$/.test(upper)) {
    return { background: GENERIC.bg, color: GENERIC.fg };
  }

  // Plain single color
  if (BASE_COLORS[upper]) {
    return { background: BASE_COLORS[upper].bg, color: BASE_COLORS[upper].fg };
  }

  // Hybrid / phyrexian / twobrid — e.g. "W/U", "2/W", "W/P"
  if (upper.includes("/")) {
    const parts = upper.split("/");
    const colorParts = parts.filter((p) => BASE_COLORS[p]);
    const numParts   = parts.filter((p) => /^\d+$/.test(p));

    if (colorParts.length === 2) {
      // Color hybrid: diagonal gradient
      return {
        background: `linear-gradient(135deg, ${BASE_COLORS[colorParts[0]].bg} 50%, ${BASE_COLORS[colorParts[1]].bg} 50%)`,
        color: "#1a1a1a",
      };
    }
    if (colorParts.length === 1 && numParts.length === 1) {
      // Twobrid (2/W): gray + color
      return {
        background: `linear-gradient(135deg, ${GENERIC.bg} 50%, ${BASE_COLORS[colorParts[0]].bg} 50%)`,
        color: "#1a1a1a",
      };
    }
    if (colorParts.length === 1) {
      // Phyrexian (W/P): use that color
      return { background: BASE_COLORS[colorParts[0]].bg, color: BASE_COLORS[colorParts[0]].fg };
    }
  }

  return { background: GENERIC.bg, color: GENERIC.fg };
}

function getLabel(sym: string): string {
  const upper = sym.toUpperCase();
  if (upper === "T") return "⟳";
  if (upper === "Q") return "↺";
  // Phyrexian: strip /P suffix for the label, add phi marker
  if (upper.endsWith("/P")) return upper.slice(0, -2) + "ᵠ";
  return upper;
}

function ManaSymbol({ symbol, size = "sm" }: { symbol: string; size?: "sm" | "md" }) {
  const style   = getStyle(symbol);
  const label   = getLabel(symbol);
  const isLong  = label.length > 2;

  const dim = size === "md"
    ? "h-[1.35rem] min-w-[1.35rem] text-[10px]"
    : "h-[1.1rem] min-w-[1.1rem] text-[9px]";

  return (
    <span
      style={{ background: style.background, color: style.color }}
      className={`inline-flex items-center justify-center rounded-full px-0.5 font-extrabold leading-none ring-1 ring-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.45)] ${dim} ${isLong ? "tracking-tight" : ""}`}
    >
      {label}
    </span>
  );
}

export function ManaCost({
  cost,
  size = "sm",
  className = "",
}: {
  cost: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!cost) return null;
  const symbols = parseMana(cost);
  if (symbols.length === 0) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-0.5 ${className}`}>
      {symbols.map((sym, i) => (
        <ManaSymbol key={i} symbol={sym} size={size} />
      ))}
    </span>
  );
}
