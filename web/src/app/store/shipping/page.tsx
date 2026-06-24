"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney, type ShippingOption } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const darkInp = "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50";
const darkSel = "h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50";

const empty = {
  name: "",
  carrier_type: "tracked",
  base_dollars: "5.00",
  per_extra_dollars: "0.25",
  min_subtotal_dollars: "",
  free_threshold_dollars: "",
  is_active: true,
};

export default function ShippingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<{ data: ShippingOption[] }>({
    queryKey: ["store-shipping"],
    queryFn: () => api.get("/store/shipping"),
    enabled: !!user,
  });

  const [creating, setCreating] = useState(false);
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-slate-400">Loading…</p>;

  async function create() {
    setErr(null);
    try {
      await api.post("/store/shipping", {
        name: f.name,
        carrier_type: f.carrier_type || null,
        base_cost_cents: Math.round(parseFloat(f.base_dollars || "0") * 100),
        per_additional_card_cents: Math.round(parseFloat(f.per_extra_dollars || "0") * 100),
        min_order_subtotal_cents: f.min_subtotal_dollars
          ? Math.round(parseFloat(f.min_subtotal_dollars) * 100)
          : null,
        free_shipping_threshold_cents: f.free_threshold_dollars
          ? Math.round(parseFloat(f.free_threshold_dollars) * 100)
          : null,
        is_active: f.is_active,
      });
      qc.invalidateQueries({ queryKey: ["store-shipping"] });
      setCreating(false);
      setF(empty);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this shipping option?")) return;
    await api.del(`/store/shipping/${id}`);
    qc.invalidateQueries({ queryKey: ["store-shipping"] });
  }

  async function toggle(opt: ShippingOption) {
    await api.patch(`/store/shipping/${opt.id}`, {
      name: opt.name,
      carrier_type: opt.carrier_type,
      base_cost_cents: opt.base_cost_cents,
      per_additional_card_cents: opt.per_additional_card_cents,
      min_order_subtotal_cents: opt.min_order_subtotal_cents,
      free_shipping_threshold_cents: opt.free_shipping_threshold_cents,
      countries: opt.countries,
      is_active: !opt.is_active,
    });
    qc.invalidateQueries({ queryKey: ["store-shipping"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold text-white">Shipping options</h1>
        <Button
          onClick={() => setCreating((v) => !v)}
          className="bg-amber-500 text-black hover:bg-amber-400"
        >
          {creating ? "Cancel" : "New option"}
        </Button>
      </div>

      {creating && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sname" className="text-slate-300">Name</Label>
              <Input id="sname" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Standard USPS" className={darkInp} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="carrier" className="text-slate-300">Carrier type</Label>
              <select id="carrier" value={f.carrier_type} onChange={(e) => setF({ ...f, carrier_type: e.target.value })} className={darkSel}>
                <option value="tracked">tracked</option>
                <option value="untracked">untracked</option>
                <option value="pickup">pickup</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="base" className="text-slate-300">Base cost ($)</Label>
              <Input id="base" type="number" step="0.01" value={f.base_dollars} onChange={(e) => setF({ ...f, base_dollars: e.target.value })} className={darkInp} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="extra" className="text-slate-300">Per additional card ($)</Label>
              <Input id="extra" type="number" step="0.01" value={f.per_extra_dollars} onChange={(e) => setF({ ...f, per_extra_dollars: e.target.value })} className={darkInp} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="min" className="text-slate-300">Minimum subtotal ($)</Label>
              <Input id="min" type="number" step="0.01" value={f.min_subtotal_dollars} onChange={(e) => setF({ ...f, min_subtotal_dollars: e.target.value })} placeholder="leave blank for none" className={darkInp} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="free" className="text-slate-300">Free shipping at ($)</Label>
              <Input id="free" type="number" step="0.01" value={f.free_threshold_dollars} onChange={(e) => setF({ ...f, free_threshold_dollars: e.target.value })} placeholder="leave blank for never" className={darkInp} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
            Active
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button onClick={create} className="bg-amber-500 text-black hover:bg-amber-400">Create</Button>
        </div>
      )}

      {data?.data.length === 0 && (
        <p className="text-slate-400">No shipping options yet. Add one so buyers can pay shipping.</p>
      )}

      <div className="space-y-2">
        {data?.data.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white">{o.name}</div>
              <div className="text-xs text-slate-400">
                {formatMoney(o.base_cost_cents, "USD")} base
                {o.per_additional_card_cents > 0 &&
                  ` + ${formatMoney(o.per_additional_card_cents, "USD")} per extra card`}
                {o.free_shipping_threshold_cents != null &&
                  ` · free at ${formatMoney(o.free_shipping_threshold_cents, "USD")}+`}
                {o.carrier_type && ` · ${o.carrier_type}`}
                {!o.is_active && " · (inactive)"}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggle(o)}
              className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              {o.is_active ? "Pause" : "Activate"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove(o.id)}
              className="text-slate-400 hover:text-destructive"
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
