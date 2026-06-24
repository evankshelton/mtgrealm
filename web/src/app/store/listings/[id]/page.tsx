"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { api, formatMoney, type MarketplaceListing } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const darkInp = "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50";

const STATUS_OPTIONS = [
  { value: "active",   label: "Active",   desc: "Visible to buyers in the marketplace" },
  { value: "paused",   label: "Paused",   desc: "Hidden from buyers, not yet delisted" },
  { value: "sold_out", label: "Sold out", desc: "Quantity exhausted" },
  { value: "delisted", label: "Delisted", desc: "Permanently removed from your store" },
] as const;

export default function ListingDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data: listing, isLoading } = useQuery<MarketplaceListing>({
    queryKey: ["store-listing", id],
    queryFn: () => api.get<MarketplaceListing>(`/store/listings/${id}`),
    enabled: !!user && !!id,
  });

  const [priceDollars, setPriceDollars] = useState("");
  const [qty, setQty] = useState("1");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (listing) {
      setPriceDollars((listing.price_cents / 100).toFixed(2));
      setQty(String(listing.quantity));
      setDesc(listing.description ?? "");
      setStatus(listing.status ?? "active");
    }
  }, [listing]);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-sm text-slate-400 p-6">Loading…</p>;
  if (!listing) return <p className="text-sm text-destructive p-6">Listing not found.</p>;

  async function save() {
    setSaving(true);
    setSaveErr(null);
    setSaved(false);
    try {
      const cents = Math.round(parseFloat(priceDollars) * 100);
      if (!cents || cents <= 0) throw new Error("Enter a valid price");
      const quantity = parseInt(qty, 10);
      if (!quantity || quantity < 0) throw new Error("Enter a valid quantity");
      await api.patch(`/store/listings/${id}`, {
        price_cents: cents,
        quantity,
        description: desc.trim() || null,
        status,
      });
      qc.invalidateQueries({ queryKey: ["store-listings"] });
      qc.invalidateQueries({ queryKey: ["store-listing", id] });
      setSaved(true);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    await api.del(`/store/listings/${id}`);
    qc.invalidateQueries({ queryKey: ["store-listings"] });
    router.push("/store/listings");
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <button
          onClick={() => router.push("/store/listings")}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          All listings
        </button>
        <h1 className="mt-1.5 text-2xl font-semibold text-white">{listing.card_name}</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {listing.set_name} · {listing.card_condition} · {listing.finish} · {listing.lang}
        </p>
      </div>

      {/* Content grid */}
      <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
        {/* Card image */}
        <div className="flex flex-col gap-3">
          {listing.image_uris?.normal || listing.image_uris?.small ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.image_uris.normal || listing.image_uris.small}
              alt={listing.card_name}
              className="w-full rounded-lg shadow-md"
            />
          ) : (
            <div className="aspect-[5/7] w-full rounded-lg bg-white/10" />
          )}
          <a
            href={`/marketplace/listings/${listing.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
          >
            <ExternalLink className="h-3 w-3" /> Buyer view
          </a>
        </div>

        {/* Edit form */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-5">
          {/* Price + qty */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="price" className="text-slate-300">Price each (USD)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0.01"
                value={priceDollars}
                onChange={(e) => { setPriceDollars(e.target.value); setSaved(false); }}
                className={darkInp}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qty" className="text-slate-300">Quantity available</Label>
              <Input
                id="qty"
                type="number"
                min="0"
                value={qty}
                onChange={(e) => { setQty(e.target.value); setSaved(false); }}
                className={darkInp}
              />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-slate-300">Status</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setStatus(opt.value); setSaved(false); }}
                  className={[
                    "rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                    status === opt.value
                      ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                      : "border-white/10 text-slate-400 hover:border-white/30 hover:text-white",
                  ].join(" ")}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="mt-0.5 block text-[11px] opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="desc" className="text-slate-300">Description</Label>
            <textarea
              id="desc"
              rows={3}
              value={desc}
              onChange={(e) => { setDesc(e.target.value); setSaved(false); }}
              placeholder="Condition notes, grading info, anything buyers should know…"
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          {saveErr && <p className="text-sm text-destructive">{saveErr}</p>}
          {saved && <p className="text-sm text-emerald-400">Changes saved.</p>}

          <div className="flex items-center justify-between pt-1">
            <Button onClick={save} disabled={saving} className="bg-amber-500 text-black hover:bg-amber-400">
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete listing
            </Button>
          </div>
        </div>
      </div>

      {/* Snapshot of saved values */}
      <p className="text-xs text-slate-500">
        Last saved: {formatMoney(listing.price_cents, listing.currency)} · qty {listing.quantity} · {listing.status ?? "active"}
      </p>

      <Dialog open={confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(false); }}>
        <DialogContent className="sm:max-w-sm bg-[#0d0d1a] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Delete listing?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-400">
            <span className="font-medium text-white">{listing.card_name}</span>
            {" — "}{listing.card_condition} · {listing.finish}
            <br />
            This will permanently remove the listing from your store. This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={doDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
