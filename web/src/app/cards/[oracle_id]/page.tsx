"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type CanonicalCard, type CardPrint } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CardDetailPage({
  params,
}: {
  params: Promise<{ oracle_id: string }>;
}) {
  const { oracle_id } = use(params);

  const canon = useQuery<CanonicalCard>({
    queryKey: ["canon", oracle_id],
    queryFn: () => api.get<CanonicalCard>(`/cards/oracle/${oracle_id}`),
  });

  const prints = useQuery<{ oracle_id: string; prints: CardPrint[] }>({
    queryKey: ["prints", oracle_id],
    queryFn: () => api.get(`/cards/oracle/${oracle_id}/prints`),
  });

  if (canon.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (canon.error) return <p className="text-destructive">{(canon.error as Error).message}</p>;
  if (!canon.data) return <p>Not found.</p>;

  const c = canon.data;
  const img = c.image_uris?.large || c.image_uris?.normal;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
      <div className="space-y-2">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={c.name} className="w-full rounded-lg" />
        ) : (
          <div className="aspect-[488/680] rounded-lg bg-muted" />
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="text-sm text-muted-foreground">
            {c.type_line}
            {c.mana_cost ? ` · ${c.mana_cost}` : ""}
            {typeof c.cmc === "number" ? ` · CMC ${c.cmc}` : ""}
          </p>
          {c.set_name && (
            <p className="text-sm text-muted-foreground">
              First seen: {c.set_name}
              {c.set_code ? ` (${c.set_code.toUpperCase()})` : ""}
            </p>
          )}
        </div>

        {c.oracle_text && (
          <div className="whitespace-pre-line text-sm leading-relaxed">{c.oracle_text}</div>
        )}

        {(c.power || c.toughness || c.loyalty) && (
          <div className="text-sm">
            {c.power && c.toughness ? `${c.power} / ${c.toughness}` : null}
            {c.loyalty ? `Loyalty: ${c.loyalty}` : null}
          </div>
        )}

        <section className="pt-2">
          <h2 className="text-lg font-medium">Printings</h2>
          {prints.isLoading && <p className="text-muted-foreground text-sm">Loading printings…</p>}
          {prints.data && (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {prints.data.prints.map((p) => (
                <li key={p.id}>
                  <Card>
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm">
                        {p.set_name} ({p.set_code?.toUpperCase()}) #{p.collector_number}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
                      {p.rarity} · {p.released_at} · {p.lang}
                      {p.foil ? " · foil" : ""}
                      {p.full_art ? " · full art" : ""}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
