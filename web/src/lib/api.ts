// Lightweight typed fetch wrapper. Browser calls /api/* which Next.js
// rewrites to the Go API (see next.config.mjs).
//
// All calls send credentials so session cookies travel with requests.

export type ApiError = {
  status: number;
  message: string;
  code?: string;
};

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const err: ApiError = {
      status: res.status,
      message: body.error ?? res.statusText,
      code: body.code,
    };
    throw err;
  }

  // 204 / empty body
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// --- typed response shapes ---

export type User = {
  id: string;
  email: string;
  display_name?: string | null;
  preferred_language: string;
  email_verified: boolean;
};

// Languages we surface in the signup picker. Scryfall codes; not exhaustive,
// but covers everything Wizards prints in. "en" is the default.
export const LANGUAGES = [
  { code: "en",  label: "English" },
  { code: "es",  label: "Spanish" },
  { code: "fr",  label: "French" },
  { code: "de",  label: "German" },
  { code: "it",  label: "Italian" },
  { code: "pt",  label: "Portuguese" },
  { code: "ja",  label: "Japanese" },
  { code: "ko",  label: "Korean" },
  { code: "ru",  label: "Russian" },
  { code: "zhs", label: "Chinese (Simplified)" },
  { code: "zht", label: "Chinese (Traditional)" },
] as const;

export type CanonicalCard = {
  oracle_id: string;
  id: string;
  name: string;
  layout?: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  rarity?: string;
  set_code?: string;
  set_name?: string;
  colors?: string[];
  color_identity?: string[];
  image_uris?: Record<string, string>;
};

export type SearchResponse = {
  total: number;
  page: number;
  limit: number;
  data: CanonicalCard[];
};

// ----- Collection (one per user, auto-provisioned) -----

export type Collection = {
  id: string;
  created_at: string;
  updated_at: string;
  item_count: number;
};

export type DeckRef = {
  deck_id: string;
  deck_name: string;
  zone: string;
  quantity: number;
  format: string | null;
  commander_name: string | null;
  commander_art_url: string | null;
};

export type ListingRef = {
  listing_id: string;
  store_id: string;
  price_cents: number;
  currency: string;
  quantity: number;
  status: string;
};

export type CollectionItem = {
  id: string;
  card_id: string;
  finish: string;
  card_condition: string;
  lang: string;
  quantity: number;
  notes: string | null;
  acquired_at: string | null;
  acquired_price_cents: number | null;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  rarity: string | null;
  type_line: string | null;
  oracle_id: string | null;
  image_uris: Record<string, string> | null;
  in_decks: DeckRef[];
  in_listings: ListingRef[];
};

export type CollectionDetail = {
  collection: Collection;
  items: CollectionItem[];
};

// ----- Decks -----

export type Deck = {
  id: string;
  name: string;
  format: string | null;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  card_count: number;
  commander_name: string | null;
  commander_art_url: string | null;
};

export type DeckEntry = {
  id: string;
  collection_item_id: string;
  zone: string;
  quantity: number;
  notes: string | null;
  // From the collection_item:
  finish: string;
  card_condition: string;
  lang: string;
  owned_quantity: number;
  // From cards (joined):
  card_id: string;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  rarity: string | null;
  type_line: string | null;
  mana_cost: string | null;
  cmc: number | null;
  oracle_id: string | null;
  image_uris: Record<string, string> | null;
};

export type DeckDetail = {
  deck: Deck;
  entries: DeckEntry[];
};

export const ZONES = ["main", "sideboard", "commander", "maybeboard"] as const;
export const FINISHES = ["nonfoil", "foil", "etched"] as const;
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export const FORMATS = [
  "standard", "pioneer", "modern", "legacy", "vintage",
  "commander", "pauper", "brawl", "historic", "explorer", "alchemy", "casual",
] as const;

export type CardPrint = {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  layout?: string;
  released_at?: string;
  set_id?: string;
  set_code?: string;
  set_name?: string;
  collector_number?: string;
  rarity?: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  artist?: string;
  border_color?: string;
  frame?: string;
  foil?: boolean;
  nonfoil?: boolean;
  promo?: boolean;
  reprint?: boolean;
  full_art?: boolean;
  textless?: boolean;
  colors?: string[];
  color_identity?: string[];
  legalities?: Record<string, string>;
  image_uris?: Record<string, string>;
  prices?: Record<string, string | null>;
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: Record<string, string>;
  }>;
};
