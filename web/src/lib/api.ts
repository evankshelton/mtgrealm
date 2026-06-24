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
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
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

// ----- Marketplace -----

export type ShippingAddress = {
  id: string;
  label: string | null;
  recipient: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  phone: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type Store = {
  id: string;
  name: string;
  slug: string;
  store_type: string;
  description: string | null;
  return_policy: string | null;
  status: string;
  default_currency: string;
  // Contact (LGS)
  phone: string | null;
  email: string | null;
  website: string | null;
  // Public storefront address (LGS)
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  // Social links
  facebook_url: string | null;
  instagram_url: string | null;
  discord_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  // Operational shipping origin
  ship_from_recipient: string | null;
  ship_from_line1: string | null;
  ship_from_line2: string | null;
  ship_from_city: string | null;
  ship_from_region: string | null;
  ship_from_postal_code: string | null;
  ship_from_country: string | null;
  created_at: string;
  updated_at: string;
};

export type StoreEvent = {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string | null;
  entry_fee_cents: number | null;
  currency: string;
  max_players: number | null;
  is_recurring: boolean;
  recurrence: "weekly" | "biweekly" | "monthly" | null;
};

export type ShippingOption = {
  id: string;
  name: string;
  carrier_type: string | null;
  base_cost_cents: number;
  per_additional_card_cents: number;
  min_order_subtotal_cents: number | null;
  free_shipping_threshold_cents: number | null;
  countries: string[] | null;
  is_active: boolean;
};

export type MarketplaceListing = {
  id: string;
  store_id: string;
  // store_name / store_slug present on buyer-facing endpoints; absent on the
  // seller's own /store/listings response.
  store_name?: string;
  store_slug?: string;
  card_id: string;
  finish: string;
  card_condition: string;
  lang: string;
  quantity: number;
  price_cents: number;
  currency: string;
  description: string | null;
  // status and created_at only on the seller's own listing rows.
  status?: string;
  created_at?: string;
  card_name: string;
  oracle_id: string | null;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  rarity: string | null;
  type_line?: string | null;
  image_uris: Record<string, string> | null;
};

export type CartLine = {
  id: string;
  listing_id: string;
  quantity: number;
  store_id: string;
  store_name: string;
  store_slug: string;
  card_id: string;
  card_name: string;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  finish: string;
  card_condition: string;
  lang: string;
  unit_price_cents: number;
  currency: string;
  available: number;
  image_uris: Record<string, string> | null;
};

export type CheckoutGroup = {
  store_id: string;
  store_name: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  shipping_option_id: string | null;
  shipping_method_name: string | null;
  currency: string;
  items: number;
};

export type Order = {
  id: string;
  buyer_id: string;
  seller_id: string;
  store_id: string;
  store_name: string;
  buyer_name: string | null;
  buyer_email: string;
  payment_intent_id: string | null;
  payment_status: string;
  status: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  shipping_method_name: string | null;
  tracking_carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  ship_to_recipient: string;
  ship_to_line1: string;
  ship_to_line2: string | null;
  ship_to_city: string;
  ship_to_region: string;
  ship_to_postal_code: string;
  ship_to_country: string;
  ship_to_phone: string | null;
  ship_from_recipient: string | null;
  ship_from_line1: string | null;
  ship_from_line2: string | null;
  ship_from_city: string | null;
  ship_from_region: string | null;
  ship_from_postal_code: string | null;
  ship_from_country: string | null;
  buyer_note: string | null;
  refund_note: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
};

export type OrderItem = {
  id: string;
  listing_id: string | null;
  card_id: string;
  quantity: number;
  unit_price_cents: number;
  card_name: string;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  finish: string;
  card_condition: string;
  lang: string;
  image_uri: string | null;
};

export type OrderMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  sender_name: string | null;
};

export type SellerReview = {
  id: string;
  order_id: string;
  buyer_id: string;
  seller_id: string;
  store_id: string;
  rating: number;
  body: string | null;
  created_at: string;
};

export function formatMoney(cents: number, currency: string): string {
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
