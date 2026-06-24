"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, CONDITIONS, FINISHES, formatMoney, type Store } from "@/lib/api";
import { ManaCost } from "@/components/mana-cost";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CardInfo = {
  oracle_id: string;
  name: string;
  type_line: string | null;
  mana_cost: string | null;
  oracle_text: string | null;
  image_uris: Record<string, string> | null;
  colors: string[] | null;
};

type CardListing = {
  id: string;
  store_id: string;
  store_name: string;
  store_slug: string;
  card_id: string;
  finish: string;
  card_condition: string;
  lang: string;
  quantity: number;
  price_cents: number;
  currency: string;
  description: string | null;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  image_uris: Record<string, string> | null;
  min_ship_cents: number | null;
};

type CartLine = {
  listing_id: string;
  store_id: string;
  quantity: number;
};

type Resp = {
  card: CardInfo;
  listings: CardListing[];
  total: number;
  page: number;
  pages: number;
};

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

const CONDITION_STYLES: Record<string, string> = {
  NM: "bg-emerald-900/50 text-emerald-300 ring-emerald-500/30",
  LP: "bg-blue-900/50 text-blue-300 ring-blue-500/30",
  MP: "bg-yellow-900/50 text-yellow-300 ring-yellow-500/30",
  HP: "bg-orange-900/50 text-orange-300 ring-orange-500/30",
  DMG: "bg-red-900/50 text-red-300 ring-red-500/30",
};

function ConditionBadge({ condition }: { condition: string }) {
  const cls = CONDITION_STYLES[condition.toUpperCase()] ?? "bg-white/5 text-slate-400 ring-white/10";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${cls}`}>
      {condition}
    </span>
  );
}

function FinishBadge({ finish }: { finish: string }) {
  const foil = finish !== "nonfoil";
  return (
    <span
      className={[
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
        foil
          ? "bg-purple-900/50 text-purple-300 ring-purple-500/30"
          : "bg-white/5 text-slate-400 ring-white/10",
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
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
        isEnglish
          ? "bg-white/5 text-slate-400 ring-white/10"
          : "bg-amber-900/50 text-amber-300 ring-amber-500/30",
      ].join(" ")}
    >
      {lang.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shipping display helper
// ---------------------------------------------------------------------------

function ShippingLabel({ min_ship_cents, currency }: { min_ship_cents: number | null; currency: string }) {
  if (min_ship_cents === null) {
    return <span className="text-slate-400">+ ship</span>;
  }
  if (min_ship_cents === 0) {
    return <span className="text-emerald-400 font-semibold">Free ship</span>;
  }
  return <span className="text-slate-300">~{formatMoney(min_ship_cents, currency)} ship</span>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CardListingsPage() {
  const { oracle_id } = useParams<{ oracle_id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [sort, setSort] = useState("total_asc");
  const [condition, setCondition] = useState("");
  const [finish, setFinish] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<Resp>({
    queryKey: ["card-listings", oracle_id, sort, condition, finish, page],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("sort", sort);
      if (condition) params.set("condition", condition);
      if (finish) params.set("finish", finish);
      params.set("page", String(page));
      params.set("limit", "20");
      return api.get<Resp>(`/marketplace/cards/${oracle_id}/listings?${params}`);
    },
  });

  // Cart data for consolidation — only fetch when logged in
  const { data: cartData } = useQuery<{ items: CartLine[] }>({
    queryKey: ["cart"],
    queryFn: () => api.get("/cart"),
    enabled: !!user,
  });

  // Own store — used to identify the user's own listings
  const { data: myStore } = useQuery<Store>({
    queryKey: ["my-store"],
    queryFn: () => api.get("/store"),
    enabled: !!user,
    retry: false,
  });
  const myStoreId = myStore?.id;

  const addToCartMutation = useMutation({
    mutationFn: ({ listing_id }: { listing_id: string }) =>
      api.post("/cart/items", { listing_id, quantity: 1 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });

  if (isLoading) {
    return (
      <div className="-mt-6 overflow-x-hidden" style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}>
        <div className="flex min-h-[60vh] items-center justify-center" style={{ background: "#0c0c14" }}>
          <p className="text-slate-400">Loading…</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="-mt-6 overflow-x-hidden" style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}>
        <div className="flex min-h-[60vh] items-center justify-center" style={{ background: "#0c0c14" }}>
          <p className="text-red-400">Card not found.</p>
        </div>
      </div>
    );
  }

  const { card, listings, total, pages } = data;

  // Build per-listing cart qty map and store set for consolidation
  const cartItems = cartData?.items ?? [];
  const cartQtyByListing = new Map<string, number>();
  for (const item of cartItems) {
    cartQtyByListing.set(item.listing_id, (cartQtyByListing.get(item.listing_id) ?? 0) + item.quantity);
  }
  const cartStoreIds = new Set(cartItems.map((i) => i.store_id));

  // Partition: cart-seller listings first, then the rest — client-side reorder
  const cartListings = listings.filter((l) => cartStoreIds.has(l.store_id));
  const otherListings = listings.filter((l) => !cartStoreIds.has(l.store_id));
  const orderedListings = cartListings.length > 0
    ? [...cartListings, ...otherListings]
    : listings;

  const cardImg = card.image_uris?.large ?? card.image_uris?.normal ?? card.image_uris?.small;

  return (
    <div className="-mt-6 overflow-x-hidden" style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}>

      {/* Dark hero header with card info */}
      <section
        className="relative overflow-hidden px-6 py-12 text-white"
        style={{ background: "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1040 0%, #09090f 60%)" }}
      >
        <div className="pointer-events-none absolute left-5 top-5 h-10 w-10 border-l-2 border-t-2 border-amber-500/30" />
        <div className="pointer-events-none absolute right-5 top-5 h-10 w-10 border-r-2 border-t-2 border-amber-500/30" />

        <div className="relative mx-auto max-w-5xl">
          <Link
            href="/marketplace"
            className="mb-6 inline-block text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            ← Back to marketplace
          </Link>

          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {/* Card image */}
            <div className="flex-shrink-0">
              {cardImg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cardImg}
                  alt={card.name}
                  className="w-48 rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.9)] sm:w-56"
                />
              ) : (
                <div className="aspect-[5/7] w-48 rounded-xl bg-white/5 ring-1 ring-white/10 sm:w-56" />
              )}
            </div>

            {/* Card details */}
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold tracking-tight">{card.name}</h1>
              {card.type_line && (
                <p className="mt-1 text-slate-400">{card.type_line}</p>
              )}
              {card.mana_cost && (
                <div className="mt-2">
                  <ManaCost cost={card.mana_cost} size="md" />
                </div>
              )}
              {card.oracle_text && (
                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-300 max-w-lg">
                  {card.oracle_text}
                </p>
              )}
              {card.colors && card.colors.length > 0 && (
                <p className="mt-3 text-xs text-slate-500 uppercase tracking-widest">
                  {card.colors.join(" · ")}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Listings section */}
      <section className="px-6 py-8" style={{ background: "#0c0c14" }}>
        <div className="mx-auto max-w-5xl">

          <div className="mb-6 h-px w-full bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />

          {/* Filter bar */}
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <select
              value={condition}
              onChange={(e) => { setPage(1); setCondition(e.target.value); }}
              className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            >
              <option value="">Any condition</option>
              {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select
              value={finish}
              onChange={(e) => { setPage(1); setFinish(e.target.value); }}
              className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            >
              <option value="">Any finish</option>
              {FINISHES.map((f) => <option key={f}>{f}</option>)}
            </select>
            <select
              value={sort}
              onChange={(e) => { setPage(1); setSort(e.target.value); }}
              className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            >
              <option value="total_asc">Price + Ship ↑</option>
              <option value="price_asc">Price ↑</option>
              <option value="price_desc">Price ↓</option>
              <option value="condition">Best condition</option>
            </select>
            <span className="ml-auto text-sm text-slate-400">
              {total.toLocaleString()} listing{total === 1 ? "" : "s"}
            </span>
          </div>

          {/* Listings */}
          {orderedListings.length === 0 && (
            <p className="py-20 text-center text-slate-400">No listings match your filters.</p>
          )}

          <div className="space-y-2">
            {/* Cart-seller consolidation banner */}
            {cartListings.length > 0 && (
              <div className="mb-1 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2.5">
                <span className="text-sm font-semibold text-amber-400">Consolidate shipping</span>
                <span className="text-sm text-amber-300/70">
                  — you already have items from {cartListings.length === 1 ? "this seller" : "these sellers"} in your cart
                </span>
              </div>
            )}

            {orderedListings.map((listing) => {
              const isOwnListing = !!myStoreId && listing.store_id === myStoreId;
              const isCartSeller = !isOwnListing && cartStoreIds.has(listing.store_id);
              const total_cents = listing.price_cents + (listing.min_ship_cents ?? 0);
              const isAdding = addToCartMutation.isPending &&
                (addToCartMutation.variables as { listing_id: string })?.listing_id === listing.id;
              const inCartQty = cartQtyByListing.get(listing.id) ?? 0;
              const remainingQty = listing.quantity - inCartQty;
              const inCartFull = inCartQty > 0 && remainingQty <= 0;

              return (
                <div
                  key={listing.id}
                  className={[
                    "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                    isOwnListing
                      ? "border-indigo-500/40 bg-indigo-950/30"
                      : isCartSeller
                      ? "border-amber-500/30 bg-amber-950/20"
                      : "border-white/5 bg-white/[0.03] hover:bg-white/[0.05]",
                  ].join(" ")}
                >
                  {/* Card thumbnail (set-specific) */}
                  <div className="flex-shrink-0">
                    {listing.image_uris?.small ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={listing.image_uris.small}
                        alt={listing.card_name}
                        className={["h-12 w-auto rounded shadow-md", isOwnListing ? "opacity-60" : ""].join(" ")}
                      />
                    ) : (
                      <div className="h-12 w-8 rounded bg-white/5" />
                    )}
                  </div>

                  {/* Seller + set info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Link
                        href={`/marketplace/stores/${listing.store_slug}`}
                        className="text-sm font-semibold text-white hover:text-amber-300 transition-colors"
                      >
                        {listing.store_name}
                      </Link>
                      {isOwnListing && (
                        <span className="inline-flex items-center rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 ring-1 ring-indigo-500/40">
                          Your listing
                        </span>
                      )}
                      {isCartSeller && (
                        <span className="text-[10px] text-amber-400/70 font-medium">
                          Already in cart — adds to existing shipment
                          {listing.min_ship_cents && listing.min_ship_cents > 0
                            ? ` · save ~${formatMoney(listing.min_ship_cents, listing.currency)}`
                            : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {listing.set_name}
                      {listing.collector_number ? ` · #${listing.collector_number}` : ""}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <ConditionBadge condition={listing.card_condition} />
                      <FinishBadge finish={listing.finish} />
                      <LangBadge lang={listing.lang} />
                    </div>
                  </div>

                  {/* Qty */}
                  <div className="flex-shrink-0 text-right">
                    <span className={["text-xs", inCartFull ? "text-amber-400/80" : "text-slate-500"].join(" ")}>
                      {inCartQty > 0
                        ? `${remainingQty} of ${listing.quantity} avail.`
                        : `${listing.quantity} avail.`}
                    </span>
                  </div>

                  {/* Price breakdown */}
                  <div className="flex-shrink-0 text-right">
                    <div className={["text-sm font-bold", isOwnListing ? "text-slate-400" : "text-white"].join(" ")}>
                      {formatMoney(listing.price_cents, listing.currency)}
                    </div>
                    <div className="text-[10px]">
                      <ShippingLabel min_ship_cents={listing.min_ship_cents} currency={listing.currency} />
                    </div>
                    <div className="text-[10px] text-slate-400 tabular-nums">
                      = {formatMoney(total_cents, listing.currency)}
                    </div>
                  </div>

                  {/* Add to cart / own listing indicator */}
                  <div className="flex-shrink-0">
                    {isOwnListing ? (
                      <span className="inline-flex items-center rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400">
                        Your card
                      </span>
                    ) : inCartFull ? (
                      <Button size="sm" disabled className="border border-amber-500/30 bg-amber-950/60 text-xs font-semibold text-amber-400 opacity-80">
                        In cart
                      </Button>
                    ) : listing.quantity > 0 ? (
                      <Button
                        size="sm"
                        disabled={!user || isAdding}
                        onClick={() => {
                          if (!user) return;
                          addToCartMutation.mutate({ listing_id: listing.id });
                        }}
                        title={!user ? "Sign in to add to cart" : undefined}
                        className="border border-amber-500/30 bg-amber-500 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                      >
                        {isAdding ? "Adding…" : "Add to cart"}
                      </Button>
                    ) : (
                      <Button size="sm" disabled className="text-xs opacity-40">
                        Sold out
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="mt-8 flex items-center justify-between">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                ← Prev
              </Button>
              <span className="text-sm text-slate-400">Page {page} of {pages}</span>
              <Button
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                Next →
              </Button>
            </div>
          )}

          <div className="mt-8 h-px w-full bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        </div>
      </section>
    </div>
  );
}
