"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Store } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const empty = {
  name: "",
  slug: "",
  description: "",
  return_policy: "",
  status: "active",
  ship_from_recipient: "",
  ship_from_line1: "",
  ship_from_line2: "",
  ship_from_city: "",
  ship_from_region: "",
  ship_from_postal_code: "",
  ship_from_country: "US",
};

export default function StoreSettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<Store>({
    queryKey: ["my-store"],
    queryFn: () => api.get("/store"),
    enabled: !!user,
    retry: false,
  });

  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setF({
        name: data.name ?? "",
        slug: data.slug ?? "",
        description: data.description ?? "",
        return_policy: data.return_policy ?? "",
        status: data.status ?? "active",
        ship_from_recipient: data.ship_from_recipient ?? "",
        ship_from_line1: data.ship_from_line1 ?? "",
        ship_from_line2: data.ship_from_line2 ?? "",
        ship_from_city: data.ship_from_city ?? "",
        ship_from_region: data.ship_from_region ?? "",
        ship_from_postal_code: data.ship_from_postal_code ?? "",
        ship_from_country: data.ship_from_country ?? "US",
      });
    }
  }, [data]);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await api.put<Store>("/store", f);
      qc.invalidateQueries({ queryKey: ["my-store"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inp = (k: keyof typeof f, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href="/store" className="text-sm text-muted-foreground hover:underline">← Store</Link>
      <h1 className="text-2xl font-semibold">Store settings</h1>

      <section className="space-y-3">
        <h2 className="font-medium">Shop</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {inp("name", "Shop name *")}
          {inp("slug", "URL slug")}
        </div>
        {inp("description", "Description (one line)")}
        <div className="space-y-1">
          <Label htmlFor="return_policy">Return policy</Label>
          <textarea
            id="return_policy"
            value={f.return_policy}
            onChange={(e) => setF({ ...f, return_policy: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
            className="h-10 w-40 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="closed">closed</option>
          </select>
        </div>
      </section>

      <section className="space-y-3 border-t pt-4">
        <h2 className="font-medium">Ship from</h2>
        <p className="text-xs text-muted-foreground">
          The return address printed on every order from your store.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {inp("ship_from_recipient", "Recipient / business name")}
          {inp("ship_from_line1", "Line 1")}
          {inp("ship_from_line2", "Line 2")}
          {inp("ship_from_city", "City")}
          {inp("ship_from_region", "State / region")}
          {inp("ship_from_postal_code", "Postal code")}
          {inp("ship_from_country", "Country (ISO-2)")}
        </div>
      </section>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
    </div>
  );
}
