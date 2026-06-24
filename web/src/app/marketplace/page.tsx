"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, CONDITIONS, FINISHES, formatMoney } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CardResult = {
  oracle_id: string;
  card_name: string;
  type_line: string | null;
  image_uris: Record<string, string> | null;
  min_price_cents: number;
  currency: string;
  seller_count: number;
  listing_count: number;
};

type BrowseResp = {
  total: number;
  page: number;
  limit: number;
  data: CardResult[];
};

export default function MarketplacePage() {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [submitted, setSubmitted] = useState(initialQ);
  const [condition, setCondition] = useState("");
  const [finish, setFinish] = useState("");
  const [order, setOrder] = useState("price_asc");
  const [page, setPage] = useState(1);

  const { data, isFetching } = useQuery<BrowseResp>({
    queryKey: ["marketplace", submitted, condition, finish, order, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (submitted) params.set("q", submitted);
      if (condition) params.set("condition", condition);
      if (finish) params.set("finish", finish);
      params.set("order", order);
      params.set("page", String(page));
      params.set("limit", "24");
      return api.get<BrowseResp>(`/marketplace/listings?${params}`);
    },
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSubmitted(q.trim());
  }

  return (
    <div className="-mt-6 overflow-x-hidden" style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}>

      {/* Hero / Search */}
      <section
        className="relative overflow-hidden px-6 py-16 text-white"
        style={{ background: "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1040 0%, #09090f 60%)" }}
      >
        <div className="pointer-events-none absolute left-5 top-5 h-10 w-10 border-l-2 border-t-2 border-amber-500/30" />
        <div className="pointer-events-none absolute right-5 top-5 h-10 w-10 border-r-2 border-t-2 border-amber-500/30" />

        <div className="relative mx-auto max-w-2xl text-center">
          <h1 className="mb-2 text-4xl font-extrabold tracking-tight">The Marketplace</h1>
          <p className="mb-1 text-slate-300">Buy singles from verified sellers.</p>
          <p className="mb-8 font-serif italic text-amber-400/50 text-sm">
            &ldquo;In the marketplace of power, value is everything.&rdquo;
          </p>

          <form className="flex gap-2" onSubmit={handleSearch}>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by card name…"
                className="h-12 pl-9 border-white/20 bg-white/10 text-white placeholder:text-slate-400 focus-visible:ring-amber-500/50"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="border border-amber-500/30 bg-amber-500 font-semibold text-black shadow-lg shadow-amber-900/40 hover:bg-amber-400"
            >
              Search
            </Button>
          </form>
        </div>
      </section>

      {/* Results */}
      <section className="px-6 py-8" style={{ background: "#0c0c14" }}>
        <div className="mx-auto max-w-6xl">

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
              value={order}
              onChange={(e) => { setPage(1); setOrder(e.target.value); }}
              className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            >
              <option value="price_asc">Price ↑</option>
              <option value="price_desc">Price ↓</option>
              <option value="name">Name</option>
            </select>
            <span className="ml-auto text-sm text-slate-400">
              {isFetching ? "Loading…" : data ? `${data.total.toLocaleString()} cards` : ""}
            </span>
          </div>

          {/* Card grid */}
          {data && data.data.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {data.data.map((r) => <CardResultCard key={r.oracle_id} result={r} />)}
            </div>
          )}

          {data && data.data.length === 0 && (
            <p className="py-20 text-center text-slate-400">No cards found.</p>
          )}

          {/* Pagination */}
          {data && (
            <div className="mt-8 flex items-center justify-between">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                ← Prev
              </Button>
              <span className="text-sm text-slate-400">Page {page}</span>
              <Button
                variant="outline"
                disabled={data.data.length < data.limit}
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

function CardResultCard({ result: r }: { result: CardResult }) {
  const imgSrc = r.image_uris?.normal ?? r.image_uris?.small;

  return (
    <Link
      href={`/marketplace/cards/${r.oracle_id}`}
      className="group relative block overflow-hidden rounded-xl transition-transform duration-200 hover:-translate-y-1"
      title={`${r.card_name}${r.type_line ? ` — ${r.type_line}` : ""}`}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={r.card_name}
          className="w-full rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.8)]"
        />
      ) : (
        <div className="aspect-[5/7] w-full rounded-xl bg-white/5 ring-1 ring-white/10" />
      )}

      {/* Gradient overlay on hover */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

      {/* Seller count chip — visible on hover */}
      <div className="absolute inset-x-0 top-1.5 px-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="block truncate rounded bg-black/75 px-1.5 py-0.5 text-center text-[9px] text-slate-200 backdrop-blur-sm">
          {r.seller_count} seller{r.seller_count === 1 ? "" : "s"}
        </span>
      </div>

      {/* Price badge — always visible */}
      <div className="absolute inset-x-0 bottom-1.5 px-1.5">
        <span className="block rounded bg-black/75 px-1.5 py-0.5 text-center text-[10px] font-bold text-amber-300 backdrop-blur-sm ring-1 ring-amber-500/20">
          from {formatMoney(r.min_price_cents, r.currency)}
        </span>
      </div>
    </Link>
  );
}
