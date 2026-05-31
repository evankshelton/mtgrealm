"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, FORMATS, type Deck } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeckTile } from "@/components/deck-tile";

type DeckListResponse = { data: Deck[]; limit: number };

export default function DecksListPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<string>("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<DeckListResponse>({
    queryKey: ["decks"],
    queryFn: () => api.get("/decks"),
    enabled: !!user,
  });

  if (loading || !user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const created = await api.post<Deck>("/decks", {
        name: name.trim(),
        format,
        description: description.trim(),
      });
      setName("");
      setFormat("");
      setDescription("");
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["decks"] });
      router.push(`/decks/${created.id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const atCap = data && data.data.length >= data.limit;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Decks</h1>
          <p className="text-muted-foreground text-sm">
            {data ? `${data.data.length} / ${data.limit} decks used` : "Loading…"}
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} disabled={!!atCap}>
          {creating ? "Cancel" : atCap ? "Limit reached" : "New deck"}
        </Button>
      </div>

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>Create deck</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="dname">Name</Label>
                <Input id="dname" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dfmt">Format (optional)</Label>
                <select
                  id="dfmt"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">(none)</option>
                  {FORMATS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ddesc">Description (optional)</Label>
                <Input id="ddesc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {data && data.data.length === 0 && (
        <p className="text-muted-foreground">No decks yet. Create one above.</p>
      )}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {data?.data.map((d) => (
          <DeckTile key={d.id} deck={d} />
        ))}
      </div>
    </div>
  );
}
