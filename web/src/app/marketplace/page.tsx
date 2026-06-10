"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, CONDITIONS, FINISHES, formatMoney, type MarketplaceListing } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type BrowseResp = {
  total: number;
  page: number;
  limit: number;
  data: MarketplaceListing[];
};

export default function MarketplacePage() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marketplace</h1>
        <p className="text-muted-foreground text-sm">Browse cards listed for sale.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSubmitted(q.trim());
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Card name…"
          className="max-w-xs"
        />
        <select
          value={condition}
          onChange={(e) => { setPage(1); setCondition(e.target.value); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select
          value={finish}
          onChange={(e) => { setPage(1); setFinish(e.target.value); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Any finish</option>
          {FINISHES.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select
          value={order}
          onChange={(e) => { setPage(1); setOrder(e.target.value); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
          <option value="name">Name</option>
          <option value="">Newest</option>
        </select>
        <Button type="submit">Search</Button>
      </form>

      {isFetching && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            {data.total.toLocaleString()} listings · page {data.page}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((l) => (
              <Link key={l.id} href={`/marketplace/listings/${l.id}`}>
                <Card className="overflow-hidden transition hover:shadow-md">
                  <CardContent className="flex items-center gap-3 p-3">
                    {l.image_uris?.small || l.image_uris?.normal ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.image_uris.small || l.image_uris.normal}
                        alt={l.card_name}
                        className="h-24 w-auto rounded"
                      />
                    ) : (
                      <div className="h-24 w-16 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{l.card_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.set_name} ({l.set_code?.toUpperCase()}) · {l.card_condition} ·{" "}
                        {l.finish} · {l.lang}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        from <span className="font-medium text-foreground">{l.store_name}</span>
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {formatMoney(l.price_cents, l.currency)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <span className="text-sm text-muted-foreground">Page {page}</span>
            <Button
              variant="outline"
              disabled={data.data.length < data.limit}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
