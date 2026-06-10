"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ShippingAddress } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

const emptyForm = {
  label: "", recipient: "", line1: "", line2: "",
  city: "", region: "", postal_code: "", country: "US", phone: "",
  is_default: false,
};

export default function AddressesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<{ data: ShippingAddress[] }>({
    queryKey: ["addresses"],
    queryFn: () => api.get("/addresses"),
    enabled: !!user,
  });

  const [creating, setCreating] = useState(false);
  const [editingID, setEditingID] = useState<string | null>(null);
  const [f, setF] = useState(emptyForm);
  const [err, setErr] = useState<string | null>(null);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  function startEdit(a: ShippingAddress) {
    setEditingID(a.id);
    setCreating(false);
    setF({
      label: a.label ?? "",
      recipient: a.recipient,
      line1: a.line1,
      line2: a.line2 ?? "",
      city: a.city,
      region: a.region,
      postal_code: a.postal_code,
      country: a.country,
      phone: a.phone ?? "",
      is_default: a.is_default,
    });
  }

  function startNew() {
    setEditingID(null);
    setCreating(true);
    setF(emptyForm);
  }

  async function save() {
    setErr(null);
    const body = {
      label: f.label || null,
      recipient: f.recipient,
      line1: f.line1,
      line2: f.line2 || null,
      city: f.city,
      region: f.region,
      postal_code: f.postal_code,
      country: f.country.toUpperCase(),
      phone: f.phone || null,
      is_default: f.is_default,
    };
    try {
      if (editingID) await api.patch(`/addresses/${editingID}`, body);
      else await api.post("/addresses", body);
      qc.invalidateQueries({ queryKey: ["addresses"] });
      setCreating(false);
      setEditingID(null);
      setF(emptyForm);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this address?")) return;
    await api.del(`/addresses/${id}`);
    qc.invalidateQueries({ queryKey: ["addresses"] });
  }

  const inp = (k: keyof typeof f, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href="/store" className="text-sm text-muted-foreground hover:underline">← Store</Link>
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Shipping addresses</h1>
        {!creating && !editingID && <Button onClick={startNew}>New address</Button>}
      </div>

      {(creating || editingID) && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {inp("label", "Label (optional)")}
              {inp("recipient", "Recipient *")}
              {inp("phone", "Phone")}
              {inp("line1", "Line 1 *")}
              {inp("line2", "Line 2")}
              {inp("city", "City *")}
              {inp("region", "State / Region *")}
              {inp("postal_code", "Postal code *")}
              {inp("country", "Country (ISO-2) *")}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.is_default}
                onChange={(e) => setF({ ...f, is_default: e.target.checked })}
              />
              Make default
            </label>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex gap-2">
              <Button onClick={save}>Save</Button>
              <Button variant="outline" onClick={() => { setCreating(false); setEditingID(null); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.data.length === 0 && (
        <p className="text-muted-foreground">No addresses saved yet.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.data.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  {a.label || a.recipient}
                  {a.is_default && (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">default</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {a.recipient}<br />
                  {a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />
                  {a.city}, {a.region} {a.postal_code}, {a.country}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Button variant="outline" size="sm" onClick={() => startEdit(a)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(a.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
