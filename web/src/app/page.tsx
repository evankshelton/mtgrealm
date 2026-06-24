"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Coins, Swords } from "lucide-react";
import {
  api,
  formatMoney,
  type CollectionDetail,
  type Deck,
  type MarketplaceListing,
  type Store,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { DeckTile } from "@/components/deck-tile";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <LandingPage />;
  return <Dashboard user={user} />;
}

// ── Landing (logged-out) ──────────────────────────────────────────────────────

// Iconic cards that represent the breadth of MTG history
const HERO_CARDS = [
  "Black Lotus",
  "Jace, the Mind Sculptor",
  "Lightning Bolt",
  "Liliana of the Veil",
  "Tarmogoyf",
  "Sol Ring",
  "Force of Will",
  "Snapcaster Mage",
  "Mox Ruby",
  "Ancestral Recall",
];

interface ScryfallCard {
  image_uris?: { normal?: string };
  card_faces?: Array<{ image_uris?: { normal?: string } }>;
}

function HeroCardStack() {
  const [images, setImages] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: HERO_CARDS.map((name) => ({ name })) }),
    })
      .then((r) => r.json())
      .then((res: { data: ScryfallCard[] }) => {
        const urls = res.data.flatMap((c) => {
          const url = c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal;
          return url ? [url] : [];
        });
        setImages(urls);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % images.length), 2800);
    return () => clearInterval(t);
  }, [images.length]);

  if (images.length === 0) return null;

  return (
    <div className="relative h-[460px] w-[340px]">
      {images.map((src, i) => {
        // Compute position relative to active: 0=front, 1=mid, 2=back, 3+=hidden
        const pos = ((i - activeIdx) % images.length + images.length) % images.length;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt="MTG card"
            draggable={false}
            className={cn(
              "absolute h-[420px] w-[300px] select-none rounded-xl object-cover",
              "shadow-[0_8px_40px_rgba(0,0,0,0.9)]",
              "transition-all duration-700 ease-in-out",
              pos === 0 && "right-4 top-0 z-30 rotate-[-2deg] scale-100 opacity-100 ring-1 ring-amber-400/40",
              pos === 1 && "right-0 top-7 z-20 rotate-[5deg] scale-[0.94] opacity-65 ring-1 ring-amber-400/20",
              pos === 2 && "right-[-8px] top-14 z-10 rotate-[11deg] scale-[0.88] opacity-35",
              pos >= 3  && "right-0 top-0 z-0 rotate-[15deg] scale-75 opacity-0",
            )}
          />
        );
      })}
      {/* Arcane glow beneath the stack */}
      <div className="pointer-events-none absolute -bottom-6 left-1/2 h-20 w-52 -translate-x-1/2 rounded-full bg-amber-500/25 blur-2xl" />
    </div>
  );
}

// MTG mana colors — used as decorative identity dots
const MANA_COLORS = [
  { label: "White", cls: "bg-[#f9f6dc] shadow-[0_0_6px_2px_rgba(249,246,220,0.4)]" },
  { label: "Blue",  cls: "bg-[#1878c4] shadow-[0_0_6px_2px_rgba(24,120,196,0.5)]" },
  { label: "Black", cls: "bg-[#6b4fa0] shadow-[0_0_6px_2px_rgba(107,79,160,0.5)]" },
  { label: "Red",   cls: "bg-[#d4160f] shadow-[0_0_6px_2px_rgba(212,22,15,0.5)]" },
  { label: "Green", cls: "bg-[#186b3a] shadow-[0_0_6px_2px_rgba(24,107,58,0.5)]" },
];

function LandingPage() {
  return (
    <div className="-mt-6 overflow-x-hidden" style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}>

      {/* ── Hero ── */}
      <section
        className="relative overflow-hidden px-6 pb-32 pt-20 text-white"
        style={{ background: "radial-gradient(ellipse 120% 80% at 60% 0%, #1a1040 0%, #09090f 55%)" }}
      >
        {/* Ambient colour washes */}
        <div className="pointer-events-none absolute -right-32 top-0 h-[600px] w-[600px] rounded-full bg-[#1a1040]/60 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 bottom-0 h-72 w-72 rounded-full bg-[#0d1a30]/80 blur-3xl" />

        {/* Ornamental corner rules */}
        <div className="pointer-events-none absolute left-5 top-5 h-10 w-10 border-l-2 border-t-2 border-amber-500/30" />
        <div className="pointer-events-none absolute right-5 top-5 h-10 w-10 border-r-2 border-t-2 border-amber-500/30" />
        <div className="pointer-events-none absolute bottom-5 left-5 h-10 w-10 border-b-2 border-l-2 border-amber-500/30" />
        <div className="pointer-events-none absolute bottom-5 right-5 h-10 w-10 border-b-2 border-r-2 border-amber-500/30" />

        {/* Animated card stack — desktop only */}
        <div className="pointer-events-none absolute right-16 top-14 hidden lg:block">
          <HeroCardStack />
        </div>

        <div className="relative mx-auto max-w-4xl">
          {/* 5 mana color dots */}
          <div className="mb-6 flex items-center gap-2">
            {MANA_COLORS.map((c) => (
              <span key={c.label} className={cn("h-3 w-3 rounded-full", c.cls)} title={c.label} />
            ))}
            <span className="ml-2 text-xs font-medium tracking-widest text-amber-400/70 uppercase">
              All five colors. One collection.
            </span>
          </div>

          <h1 className="mb-4 text-5xl font-extrabold leading-[1.08] tracking-tight md:text-6xl lg:text-7xl">
            Your MTG collection,
            <br />
            <span className="bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-300 bg-clip-text text-transparent">
              finally organized.
            </span>
          </h1>

          {/* Flavor text — italic, like a card */}
          <p className="mb-5 font-serif italic text-amber-400/50 text-sm">
            &ldquo;The Library of Leng holds every card ever played. Yours should too.&rdquo;
          </p>

          <p className="mb-8 max-w-xl text-lg leading-relaxed text-slate-300">
            Every set. Every printing. Every foil. Track your entire collection, build decks from
            cards you actually own, and sell your extras to other players.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="border border-amber-500/30 bg-amber-500 font-semibold text-black shadow-lg shadow-amber-900/40 hover:bg-amber-400"
            >
              <Link href="/signup">Get started now</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/5 text-white hover:border-amber-400/30 hover:bg-white/10"
            >
              <Link href="/marketplace">Browse marketplace</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section
        className="px-6 py-20 text-white"
        style={{ background: "#0c0c14" }}
      >
        {/* Thin gold rule */}
        <div className="mx-auto mb-14 max-w-5xl">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        </div>

        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-white">
              Command every aspect of your collection
            </h2>
            <p className="mx-auto max-w-lg text-slate-400">
              Built for collectors who know the difference between a regular and a showcase foil.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              icon={<BookOpen className="h-5 w-5" />}
              accentClass="border-blue-500/30 bg-blue-950/40 text-blue-300"
              glowClass="shadow-blue-900/30"
              manaColor="bg-[#1878c4]"
              title="Scry Your Collection"
              description="Track every card by set, printing, finish, condition, and language. From Alpha power to the latest Secret Lair — if you own it, you know it."
              flavor="&ldquo;Knowledge is the most powerful spell.&rdquo;"
              href="/signup"
              cta="Start tracking"
            />
            <FeatureCard
              icon={<Swords className="h-5 w-5" />}
              accentClass="border-red-500/30 bg-red-950/40 text-red-300"
              glowClass="shadow-red-900/30"
              manaColor="bg-[#d4160f]"
              title="Build Your Decks"
              description="Construct decks from the real cards in your hands. Know whether you own the exact printing you need before you sit down at the table."
              flavor="&ldquo;A deck built on truth wins more than one built on hope.&rdquo;"
              href="/signup"
              cta="Build a deck"
            />
            <FeatureCard
              icon={<Coins className="h-5 w-5" />}
              accentClass="border-amber-500/30 bg-amber-950/40 text-amber-300"
              glowClass="shadow-amber-900/30"
              manaColor="bg-[#c8960c]"
              title="Trade &amp; Sell"
              description="List extras directly from your collection. Set your prices, configure shipping, and sell to other players — no middleman."
              flavor="&ldquo;In the marketplace of power, value is everything.&rdquo;"
              href="/marketplace"
              cta="Browse listings"
            />
          </div>
        </div>

        <div className="mx-auto mt-14 max-w-5xl">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        </div>
      </section>

      {/* ── How it works ── */}
      <section
        className="px-6 py-20 text-white"
        style={{ background: "#09090f" }}
      >
        <div className="mx-auto max-w-4xl">
          <div className="mb-14 text-center">
            <h2 className="mb-2 text-3xl font-bold tracking-tight">Up and running in minutes</h2>
            <p className="text-sm italic text-amber-400/50">
              &ldquo;Even the greatest planeswalker started with a single card.&rdquo;
            </p>
          </div>

          <div className="grid gap-10 md:grid-cols-3">
            {[
              {
                n: "I",
                title: "Create your account",
                desc: "Create your account and get in immediately.",
              },
              {
                n: "II",
                title: "Log your cards",
                desc: "Search any card and record the exact printing, finish, and condition you own.",
              },
              {
                n: "III",
                title: "Play or profit",
                desc: "Sleeve up a deck built from real cards you own, or sell your extras on the marketplace.",
              },
            ].map(({ n, title, desc }) => (
              <div key={n} className="flex flex-col items-center text-center">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-amber-500/40 bg-gradient-to-br from-amber-700/30 to-amber-900/30 font-serif text-xl font-bold text-amber-300 shadow-lg shadow-amber-900/30">
                  {n}
                </div>
                <h3 className="mb-2 font-semibold text-white">{title}</h3>
                <p className="text-sm text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Value prop ── */}
      <section className="px-6 py-16" style={{ background: "#0c0c14" }}>
        <div className="mx-auto max-w-5xl">
          <div
            className="rounded-2xl border border-amber-500/20 p-8 md:p-12"
            style={{ background: "linear-gradient(135deg, #110e1c 0%, #0d1020 100%)" }}
          >
            <div className="grid items-center gap-10 md:grid-cols-2">
              <div>
                <h2 className="mb-4 text-3xl font-bold tracking-tight text-white">
                  Know your library. Rule the game.
                </h2>
                <p className="mb-6 text-slate-400">
                  Whether you hold 100 cards or 100,000, MTG Realm gives you command of your
                  collection — down to the exact foil treatment and set symbol.
                </p>
                <ul className="space-y-3">
                  {[
                    "Track alt-art, etched, and textured foil variants",
                    "Monitor your collection's market value",
                    "Never accidentally buy a card you already own",
                    "Sell peer-to-peer at fair prices",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-sm text-slate-300">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Second rotating card stack */}
              <div className="flex justify-center">
                <div className="relative h-[460px] w-[340px]">
                  <HeroCardStack />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section
        className="px-6 py-28 text-center text-white"
        style={{ background: "radial-gradient(ellipse 100% 100% at 50% 100%, #1a1040 0%, #09090f 60%)" }}
      >
        {/* Ornamental rule */}
        <div className="mx-auto mb-10 flex max-w-xs items-center gap-3">
          <div className="h-px flex-1 bg-amber-500/30" />
          <span className="text-amber-500/50 text-lg">✦</span>
          <div className="h-px flex-1 bg-amber-500/30" />
        </div>

        <div className="relative mx-auto max-w-2xl">
          <div className="pointer-events-none absolute inset-0 -m-20 rounded-full bg-amber-600/10 blur-3xl" />
          <div className="relative">
            <h2 className="mb-3 text-4xl font-extrabold tracking-tight">
              Ready to master your collection?
            </h2>
            <p className="mb-2 text-slate-300">Your collection awaits.</p>
            <p className="mb-8 font-serif italic text-amber-400/50 text-sm">
              &ldquo;The greatest power is knowing exactly what you hold.&rdquo;
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button
                asChild
                size="lg"
                className="border border-amber-500/30 bg-amber-500 font-semibold text-black shadow-lg shadow-amber-900/40 hover:bg-amber-400"
              >
                <Link href="/signup">Get started now</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/20 bg-white/5 text-white hover:border-amber-400/30 hover:bg-white/10"
              >
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-10 flex max-w-xs items-center gap-3">
          <div className="h-px flex-1 bg-amber-500/30" />
          <span className="text-amber-500/50 text-lg">✦</span>
          <div className="h-px flex-1 bg-amber-500/30" />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  accentClass,
  glowClass,
  manaColor,
  title,
  description,
  flavor,
  href,
  cta,
}: {
  icon: React.ReactNode;
  accentClass: string;
  glowClass: string;
  manaColor: string;
  title: string;
  description: string;
  flavor: string;
  href: string;
  cta: string;
}) {
  return (
    <div
      className={cn(
        "group relative rounded-xl border p-6 transition-all duration-300 hover:-translate-y-0.5",
        "hover:shadow-xl",
        accentClass,
        glowClass,
      )}
    >
      {/* Mana colour dot in corner */}
      <span className={cn("absolute right-4 top-4 h-2.5 w-2.5 rounded-full opacity-70", manaColor)} />

      <div className={cn("mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg border", accentClass)}>
        {icon}
      </div>
      <h3 className="mb-2 font-semibold text-white">{title}</h3>
      <p className="mb-3 text-sm text-slate-400">{description}</p>
      {/* Flavor text */}
      <p
        className="mb-4 font-serif italic text-[11px] opacity-50"
        dangerouslySetInnerHTML={{ __html: flavor }}
      />
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-current opacity-70 hover:opacity-100">
        <Link href={href}>{cta} →</Link>
      </Button>
    </div>
  );
}

// ── Dashboard (logged-in) ─────────────────────────────────────────────────────

type DeckListResponse = { data: Deck[]; limit: number };
type MarketplaceResponse = { total: number; data: MarketplaceListing[] };

function Dashboard({ user }: { user: { display_name?: string | null; email: string } }) {
  const { data: collectionData, isLoading: collectionLoading } = useQuery<CollectionDetail>({
    queryKey: ["collection"],
    queryFn: () => api.get("/collection"),
  });

  const { data: decksData, isLoading: decksLoading } = useQuery<DeckListResponse>({
    queryKey: ["decks"],
    queryFn: () => api.get("/decks"),
  });

  const { data: storeData, isLoading: storeLoading, error: storeError } = useQuery<Store>({
    queryKey: ["my-store"],
    queryFn: () => api.get("/store"),
    retry: false,
  });

  const { data: marketplaceData } = useQuery<MarketplaceResponse>({
    queryKey: ["marketplace-preview"],
    queryFn: () => api.get("/marketplace/listings?limit=8"),
    staleTime: 60_000,
  });

  const items = collectionData?.items ?? [];
  const decks = decksData?.data ?? [];

  const isNewUser = !collectionLoading && !decksLoading && items.length === 0 && decks.length === 0;
  const totalQty  = items.reduce((s, it) => s + it.quantity, 0);
  const inDecks   = items.filter((it) => it.in_decks.length > 0).length;
  const forSale   = items.filter((it) => it.in_listings.length > 0).length;
  const storeNotFound = !storeLoading && (storeError as { status?: number } | null)?.status === 404;
  const name = user.display_name || user.email.split("@")[0];

  return (
    <div className="space-y-6 text-white">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {name}.</h1>
        <p className="text-sm text-slate-400">
          {isNewUser ? "Let's get you set up." : "Here's where things stand."}
        </p>
      </div>

      {/* Getting started (new users only) */}
      {isNewUser && <GettingStarted />}

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* Collection & Decks — 2/3 */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] lg:col-span-2">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Collection &amp; Decks</p>
              <Link href="/collection" className="text-xs text-slate-500 transition-colors hover:text-slate-300">
                Open →
              </Link>
            </div>
            {!collectionLoading && (
              <p className="mt-0.5 text-xs text-slate-500">
                {totalQty.toLocaleString()} cards · {items.length.toLocaleString()} entries
                {inDecks > 0 && ` · ${inDecks} in decks`}
                {forSale > 0 && ` · ${forSale} for sale`}
                {decks.length > 0 && ` · ${decks.length} deck${decks.length !== 1 ? "s" : ""}`}
              </p>
            )}
          </div>
          <div className="space-y-4 p-4">
            {items.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Recent cards
                </p>
                <div className="flex gap-2 overflow-hidden">
                  {items.slice(0, 7).map((it) =>
                    it.image_uris?.small ? (
                      <Link key={it.id} href={`/collection/items/${it.id}`} title={it.card_name}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={it.image_uris.small as string}
                          alt={it.card_name}
                          className="h-24 w-auto rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.7)] transition duration-200 hover:-translate-y-0.5 hover:opacity-90"
                        />
                      </Link>
                    ) : (
                      <div key={it.id} className="h-24 w-16 rounded-lg bg-white/5" />
                    )
                  )}
                </div>
              </div>
            )}

            {decks.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Decks
                </p>
                <div className="flex gap-2 overflow-hidden">
                  {decks.slice(0, 5).map((d) => (
                    <DeckTile key={d.id} deck={d} className="h-24 w-auto" />
                  ))}
                </div>
              </div>
            )}

            {items.length === 0 && !collectionLoading && (
              <p className="text-sm text-slate-500">
                Your collection is empty — add your first card to get started.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                asChild
                size="sm"
                className="border border-amber-500/30 bg-amber-500 font-semibold text-black hover:bg-amber-400"
              >
                <Link href="/collection">View collection</Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <Link href="/collection">New deck</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Store — 1/3 */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] lg:col-span-1">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Store</p>
              {storeData && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    storeData.status === "active"
                      ? "bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "bg-white/5 text-slate-400 ring-1 ring-white/10"
                  }`}
                >
                  {storeData.status}
                </span>
              )}
            </div>
            {storeData && (
              <p className="mt-0.5 text-xs text-slate-500">
                <Link
                  href={`/marketplace/stores/${storeData.slug}`}
                  className="transition-colors hover:text-slate-300"
                >
                  {storeData.name}
                </Link>
              </p>
            )}
            {storeNotFound && (
              <p className="mt-0.5 text-xs text-slate-500">Sell your extras on the marketplace</p>
            )}
          </div>
          <div className="space-y-3 p-4">
            {storeLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {storeNotFound && (
              <>
                <p className="text-sm text-slate-400">
                  Set up a store to list cards from your collection for sale.
                </p>
                <Button
                  asChild
                  size="sm"
                  className="border border-amber-500/30 bg-amber-500 font-semibold text-black hover:bg-amber-400"
                >
                  <Link href="/store/settings">Create your store</Link>
                </Button>
              </>
            )}
            {storeData && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { href: "/store/listings", label: "Listings" },
                    { href: "/store/orders",   label: "Orders" },
                    { href: "/store/shipping", label: "Shipping" },
                    { href: "/store/settings", label: "Settings" },
                  ].map(({ href, label }) => (
                    <Button
                      key={href}
                      asChild
                      size="sm"
                      variant="outline"
                      className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                      <Link href={href}>{label}</Link>
                    </Button>
                  ))}
                </div>
                <Link
                  href={`/marketplace/stores/${storeData.slug}`}
                  className="block text-xs text-slate-500 transition-colors hover:text-slate-300"
                >
                  View public store page →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Marketplace preview — full width */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] lg:col-span-3">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Marketplace</p>
              <Link href="/marketplace" className="text-xs text-slate-500 transition-colors hover:text-slate-300">
                Browse all →
              </Link>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">Recent cards available to buy</p>
          </div>
          <div className="space-y-4 p-4">
            {marketplaceData && marketplaceData.data.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {marketplaceData.data.slice(0, 6).map((l) =>
                  l.image_uris?.small ? (
                    <Link
                      key={l.id}
                      href={`/marketplace/listings/${l.id}`}
                      title={`${l.card_name} — ${formatMoney(l.price_cents, l.currency)}`}
                      className="group relative block overflow-hidden rounded-xl transition-transform duration-200 hover:-translate-y-1"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={l.image_uris.small as string}
                        alt={l.card_name}
                        className="w-full rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.8)]"
                      />
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      <span className="absolute inset-x-0 bottom-1.5 px-1.5">
                        <span className="block rounded bg-black/75 px-1.5 py-0.5 text-center text-[10px] font-bold text-amber-300 backdrop-blur-sm ring-1 ring-amber-500/20">
                          {formatMoney(l.price_cents, l.currency)}
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <div key={l.id} className="aspect-[5/7] rounded-xl bg-white/5 ring-1 ring-white/10" />
                  )
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No listings available yet.</p>
            )}
            <Button
              asChild
              size="sm"
              variant="outline"
              className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <Link href="/marketplace">Browse marketplace</Link>
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Getting started (new users) ───────────────────────────────────────────────

const STEPS = [
  {
    n: "1",
    title: "Add cards to your collection",
    body: "Track every card you own by printing, finish, and condition.",
    href: "/collection",
    cta: "Open collection",
  },
  {
    n: "2",
    title: "Build your first deck",
    body: "Create a deck and add cards straight from your collection.",
    href: "/collection",
    cta: "Create a deck",
  },
  {
    n: "3",
    title: "Set up your store",
    body: "List extras for sale and configure shipping to start earning.",
    href: "/store/settings",
    cta: "Create store",
  },
];

function GettingStarted() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm font-semibold text-white">Getting started</p>
      <p className="mb-4 mt-0.5 text-xs text-slate-500">Three steps to get the most out of mtg</p>
      <ol className="space-y-4">
        {STEPS.map(({ n, title, body, href, cta }) => (
          <li key={n} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-300 ring-1 ring-amber-500/30">
              {n}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">{title}</p>
              <p className="text-xs text-slate-500">{body}</p>
            </div>
            <Button
              asChild
              size="sm"
              variant="outline"
              className="shrink-0 border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <Link href={href}>{cta}</Link>
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}
