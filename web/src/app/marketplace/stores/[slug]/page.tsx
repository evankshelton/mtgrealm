"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Phone, Mail, Globe, Facebook, Instagram, Youtube, Twitter } from "lucide-react";
import { api, formatMoney, type MarketplaceListing, type StoreEvent } from "@/lib/api";

type PublicStore = {
  id: string;
  name: string;
  slug: string;
  store_type: string;
  description: string | null;
  return_policy: string | null;
  default_currency: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  discord_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
};

type Resp = {
  store: PublicStore;
  listings: MarketplaceListing[];
  events: StoreEvent[];
  avg_rating: number | null;
  review_count: number;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  fnm: "Friday Night Magic",
  prerelease: "Pre-release",
  draft: "Draft",
  commander: "Commander",
  standard: "Standard",
  modern: "Modern",
  pioneer: "Pioneer",
  legacy: "Legacy",
  vintage: "Vintage",
  other: "Event",
};

function formatEventSchedule(e: StoreEvent): string {
  const start = new Date(e.starts_at);
  if (!e.is_recurring) {
    return start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  const day = start.toLocaleDateString(undefined, { weekday: "long" });
  const time = start.toLocaleTimeString(undefined, { timeStyle: "short" });
  const rules: Record<string, string> = { weekly: "Every", biweekly: "Every other", monthly: "Monthly —" };
  const prefix = e.recurrence ? (rules[e.recurrence] ?? "Every") : "Every";
  return `${prefix} ${day} · ${time}`;
}

export default function PublicStorePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { data, isLoading, error } = useQuery<Resp>({
    queryKey: ["public-store", slug],
    queryFn: () => api.get(`/marketplace/stores/${slug}`),
  });

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const { store: s, listings, events } = data;
  const isLGS = s.store_type === "lgs";

  const socialLinks = [
    { url: s.facebook_url,  Icon: Facebook,  label: "Facebook" },
    { url: s.instagram_url, Icon: Instagram, label: "Instagram" },
    { url: s.twitter_url,   Icon: Twitter,   label: "X / Twitter" },
    { url: s.youtube_url,   Icon: Youtube,   label: "YouTube" },
    // Discord doesn't have a lucide icon — use a text badge
    { url: s.discord_url,   Icon: null,      label: "Discord" },
  ].filter((l) => l.url);

  const hasAddress = s.address_line1 || s.address_city;

  return (
    <div className="space-y-8">
      <Link href="/marketplace" className="text-sm text-slate-400 hover:text-white hover:underline">
        ← Marketplace
      </Link>

      {/* ── Header ── */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-white">{s.name}</h1>
          {isLGS && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
              Local Game Store
            </span>
          )}
        </div>

        {data.review_count > 0 ? (
          <p className="text-sm text-slate-400">
            ★ {data.avg_rating?.toFixed(1)} · {data.review_count} review
            {data.review_count === 1 ? "" : "s"}
          </p>
        ) : (
          <p className="text-sm text-slate-400">No reviews yet.</p>
        )}
        {s.description && <p className="text-sm text-slate-300">{s.description}</p>}
      </header>

      {/* ── LGS info bar ── */}
      {isLGS && (s.phone || s.email || s.website || hasAddress || socialLinks.length > 0) && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          {/* Contact row */}
          <div className="flex flex-wrap gap-4 text-sm">
            {s.phone && (
              <a href={`tel:${s.phone}`} className="flex items-center gap-1.5 text-slate-400 hover:text-white">
                <Phone className="h-3.5 w-3.5 shrink-0" /> {s.phone}
              </a>
            )}
            {s.email && (
              <a href={`mailto:${s.email}`} className="flex items-center gap-1.5 text-slate-400 hover:text-white">
                <Mail className="h-3.5 w-3.5 shrink-0" /> {s.email}
              </a>
            )}
            {s.website && (
              <a href={s.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-slate-400 hover:text-white">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                {s.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}
          </div>

          {/* Address */}
          {hasAddress && (
            <div className="flex items-start gap-1.5 text-sm text-slate-400">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {[s.address_line1, s.address_line2, s.address_city,
                  s.address_region, s.address_postal_code]
                  .filter(Boolean).join(", ")}
              </span>
            </div>
          )}

          {/* Social links */}
          {socialLinks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {socialLinks.map(({ url, Icon, label }) =>
                url ? (
                  <a
                    key={label}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-400 transition-colors hover:border-white/30 hover:text-white"
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                    {label}
                  </a>
                ) : null
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Upcoming events (LGS) ── */}
      {isLGS && events.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-white">Upcoming events</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <div key={e.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-1">
                <div className="flex flex-wrap items-start gap-1.5">
                  <span className="text-sm font-medium leading-snug text-white">{e.title}</span>
                  <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 uppercase tracking-wide">
                    {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
                  </span>
                  {e.is_recurring && (
                    <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-medium text-blue-300 uppercase tracking-wide">
                      Recurring
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {formatEventSchedule(e)}
                  {e.ends_at && ` – ${new Date(e.ends_at).toLocaleTimeString(undefined, { timeStyle: "short" })}`}
                </p>
                {(e.entry_fee_cents != null || e.max_players != null) && (
                  <p className="text-xs text-slate-400">
                    {e.entry_fee_cents != null && `${formatMoney(e.entry_fee_cents, e.currency)} entry`}
                    {e.entry_fee_cents != null && e.max_players != null && " · "}
                    {e.max_players != null && `${e.max_players} players max`}
                  </p>
                )}
                {e.description && (
                  <p className="text-xs text-slate-400 line-clamp-2">{e.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Return policy ── */}
      {s.return_policy && (
        <p className="whitespace-pre-line text-sm text-slate-400">
          <span className="font-medium text-white">Return policy:</span>{" "}
          {s.return_policy}
        </p>
      )}

      {/* ── Listings ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-white">Listings</h2>
        {listings.length === 0 ? (
          <p className="text-slate-400 text-sm">No active listings.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {listings.map((l) => (
              <Link
                key={l.id}
                href={`/marketplace/listings/${l.id}`}
                className="group relative block overflow-hidden rounded-xl transition-transform duration-200 hover:-translate-y-1"
                title={`${l.card_name} — ${l.card_condition} · ${l.finish}`}
              >
                {l.image_uris?.small || l.image_uris?.normal ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(l.image_uris.small ?? l.image_uris.normal) as string}
                    alt={l.card_name}
                    className="w-full rounded-xl shadow-sm"
                  />
                ) : (
                  <div className="aspect-[5/7] w-full rounded-xl bg-white/10" />
                )}
                <div className="absolute inset-x-0 bottom-1.5 px-1.5">
                  <span className="block rounded bg-black/70 px-1.5 py-0.5 text-center text-[10px] font-bold text-white backdrop-blur-sm">
                    {formatMoney(l.price_cents, l.currency)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
