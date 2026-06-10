"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatMoney, type MarketplaceListing } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

type Resp = {
  store: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    return_policy: string | null;
    default_currency: string;
  };
  listings: MarketplaceListing[];
  avg_rating: number | null;
  review_count: number;
};

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

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Link href="/marketplace" className="text-sm text-muted-foreground hover:underline">
        ← Marketplace
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{data.store.name}</h1>
        {data.review_count > 0 ? (
          <p className="text-sm text-muted-foreground">
            ★ {data.avg_rating?.toFixed(1)} · {data.review_count} review
            {data.review_count === 1 ? "" : "s"}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No reviews yet.</p>
        )}
        {data.store.description && (
          <p className="text-sm">{data.store.description}</p>
        )}
        {data.store.return_policy && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Return policy:</span>{" "}
            {data.store.return_policy}
          </p>
        )}
      </header>

      <h2 className="text-lg font-medium">Listings</h2>
      {data.listings.length === 0 ? (
        <p className="text-muted-foreground">No active listings.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.listings.map((l) => (
            <Link key={l.id} href={`/marketplace/listings/${l.id}`}>
              <Card className="overflow-hidden transition hover:shadow-md">
                <CardContent className="flex items-center gap-3 p-3">
                  {l.image_uris?.small || l.image_uris?.normal ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.image_uris.small || l.image_uris.normal}
                      alt={l.card_name}
                      className="h-20 w-auto rounded"
                    />
                  ) : (
                    <div className="h-20 w-14 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{l.card_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.set_name} · {l.card_condition} · {l.finish}
                    </div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(l.price_cents, l.currency)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
