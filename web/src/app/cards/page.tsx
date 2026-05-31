"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type SearchResponse } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function CardsSearchPage() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);

  const { data, isFetching, error } = useQuery<SearchResponse>({
    queryKey: ["cards-search", submitted, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (submitted) params.set("q", submitted);
      params.set("page", String(page));
      params.set("limit", "24");
      return api.get<SearchResponse>(`/cards/search?${params}`);
    },
    enabled: submitted.length > 0 || page > 1,
  });

  return (
    <div className="space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSubmitted(q.trim());
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search card name (e.g. Lightning Bolt)"
        />
        <Button type="submit">Search</Button>
      </form>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isFetching && <p className="text-muted-foreground text-sm">Searching…</p>}

      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            {data.total.toLocaleString()} cards · page {data.page}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.data.map((c) => (
              <Link key={c.oracle_id} href={`/cards/${c.oracle_id}`}>
                <Card className="overflow-hidden transition hover:shadow-md">
                  <CardContent className="p-2">
                    {c.image_uris?.large || c.image_uris?.normal ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.image_uris.normal || c.image_uris.large}
                        alt={c.name}
                        className="aspect-[488/680] w-full rounded"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-[488/680] w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                        no image
                      </div>
                    )}
                    <div className="pt-2 text-sm font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.type_line ?? ""}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4">
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
