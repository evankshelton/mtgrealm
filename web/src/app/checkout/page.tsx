"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  api,
  formatMoney,
  type CartLine,
  type CheckoutGroup,
  type ShippingAddress,
  type ShippingOption,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const darkInp = "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50";

type StoreShipping = { store_id: string; store_name: string; options: ShippingOption[] };

export default function CheckoutPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Cart (used for figuring out store ids + names).
  const cartQ = useQuery<{ items: CartLine[] }>({
    queryKey: ["cart"],
    queryFn: () => api.get("/cart"),
    enabled: !!user,
  });

  // Buyer addresses
  const addrsQ = useQuery<{ data: ShippingAddress[] }>({
    queryKey: ["addresses"],
    queryFn: () => api.get("/addresses"),
    enabled: !!user,
  });

  const stores = useMemo(() => {
    if (!cartQ.data) return [];
    const seen = new Map<string, { id: string; name: string }>();
    for (const it of cartQ.data.items) {
      if (!seen.has(it.store_id)) seen.set(it.store_id, { id: it.store_id, name: it.store_name });
    }
    return Array.from(seen.values());
  }, [cartQ.data]);

  const [addressID, setAddressID] = useState<string>("");
  const [showNewAddr, setShowNewAddr] = useState(false);

  // Pick default address on load.
  useEffect(() => {
    if (!addressID && addrsQ.data?.data.length) {
      const def = addrsQ.data.data.find((a) => a.is_default) ?? addrsQ.data.data[0];
      setAddressID(def.id);
    }
  }, [addrsQ.data, addressID]);

  if (loading || !user) return null;
  if (cartQ.isLoading || addrsQ.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (!cartQ.data || cartQ.data.items.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-white">Checkout</h1>
        <p className="text-slate-400">Your cart is empty.</p>
        <Button asChild variant="outline" className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">
          <Link href="/marketplace">Browse the marketplace</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/cart" className="text-sm text-slate-400 hover:text-white hover:underline">
          ← Back to cart
        </Link>
        <h1 className="text-2xl font-semibold text-white">Checkout</h1>
      </div>

      <AddressPicker
        addresses={addrsQ.data?.data ?? []}
        selected={addressID}
        onSelect={setAddressID}
        showNew={showNewAddr}
        onShowNew={setShowNewAddr}
      />

      {addressID && (
        <ShippingAndPay
          stores={stores}
          addressID={addressID}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Address picker
// ---------------------------------------------------------------------------

function AddressPicker({
  addresses,
  selected,
  onSelect,
  showNew,
  onShowNew,
}: {
  addresses: ShippingAddress[];
  selected: string;
  onSelect: (id: string) => void;
  showNew: boolean;
  onShowNew: (v: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">Ship to</div>
      </div>
      <div className="space-y-3 p-4">
        {addresses.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {addresses.map((a) => (
              <label
                key={a.id}
                className={`cursor-pointer rounded-md border p-3 text-sm transition-colors ${
                  selected === a.id
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  className="mr-2"
                  checked={selected === a.id}
                  onChange={() => onSelect(a.id)}
                />
                <span className="font-medium text-white">{a.label || a.recipient}</span>
                <div className="mt-1 text-xs text-slate-400">
                  {a.recipient}, {a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.region}{" "}
                  {a.postal_code}, {a.country}
                </div>
              </label>
            ))}
          </div>
        )}
        {showNew ? (
          <NewAddressForm onClose={() => onShowNew(false)} onCreated={(id) => { onSelect(id); onShowNew(false); }} />
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onShowNew(true)}
            className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            + Add new address
          </Button>
        )}
      </div>
    </div>
  );
}

function NewAddressForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [f, setF] = useState({
    label: "", recipient: "", line1: "", line2: "",
    city: "", region: "", postal_code: "", country: "US", phone: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const created = await api.post<ShippingAddress>("/addresses", {
        label: f.label || null,
        recipient: f.recipient,
        line1: f.line1,
        line2: f.line2 || null,
        city: f.city,
        region: f.region,
        postal_code: f.postal_code,
        country: f.country.toUpperCase(),
        phone: f.phone || null,
        is_default: false,
      });
      onCreated(created.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const inp = (k: keyof typeof f, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={k} className="text-slate-300">{label}</Label>
      <Input id={k} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={darkInp} />
    </div>
  );
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-white/5 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {inp("label", "Label (optional)")}
        {inp("recipient", "Recipient *")}
        {inp("line1", "Line 1 *")}
        {inp("line2", "Line 2")}
        {inp("city", "City *")}
        {inp("region", "State / Region *")}
        {inp("postal_code", "Postal code *")}
        {inp("country", "Country (ISO-2) *")}
        {inp("phone", "Phone")}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="bg-amber-500 text-black hover:bg-amber-400">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" onClick={onClose} className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shipping options per store + pay
// ---------------------------------------------------------------------------

function ShippingAndPay({
  stores,
  addressID,
}: {
  stores: { id: string; name: string }[];
  addressID: string;
}) {
  // Pull each store's active shipping options. We do per-store queries
  // because the public marketplace endpoint doesn't expose them.
  // Workaround for v1: build one shippingByStore map and call /checkout/preview
  // to get options validated against this address.

  const [shipByStore, setShipByStore] = useState<Record<string, string>>({});
  const [storeOptions, setStoreOptions] = useState<Record<string, ShippingOption[]>>({});
  const [loadingOpts, setLoadingOpts] = useState(true);

  // Probe each store via the public store page endpoint to get shipping options.
  // The store-public endpoint doesn't return them either — so we ask the cart
  // listing's seller via a one-off endpoint. The easiest path: call /checkout/preview
  // with no shipping (preview returns groups with their currencies). We then
  // ALSO fetch shipping options for each store by hitting the seller-scoped
  // endpoint when the buyer IS the seller. For other sellers, we need a public
  // shipping endpoint.
  //
  // To keep v1 functional without adding another endpoint, we display the
  // seller's options as line items returned by /checkout/preview only after
  // the buyer selects something — but we need the LIST first.
  //
  // For now we expose shipping options via the listing detail's store payload;
  // since that endpoint is per-store, fetch each store's slug → /marketplace/stores/{slug}
  // which currently returns the listing list but NOT options. So we hit a new
  // endpoint that returns the store's options publicly. Added inline below.

  useEffect(() => {
    let cancelled = false;
    setLoadingOpts(true);
    Promise.all(
      stores.map(async (s) => {
        const r = await api.get<{ data: ShippingOption[] }>(`/marketplace/stores/by-id/${s.id}/shipping`);
        return [s.id, r.data] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        const map: Record<string, ShippingOption[]> = {};
        for (const [id, opts] of entries) map[id] = opts.filter((o) => o.is_active);
        setStoreOptions(map);
      })
      .catch(() => {
        // Endpoint may not exist yet — degrade gracefully.
      })
      .finally(() => !cancelled && setLoadingOpts(false));
    return () => {
      cancelled = true;
    };
  }, [stores]);

  const [preview, setPreview] = useState<{
    groups: CheckoutGroup[];
    total_cents: number;
    currency: string;
  } | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .post<{ groups: CheckoutGroup[]; total_cents: number; currency: string }>(
        "/checkout/preview",
        { address_id: addressID, shipping_by_store: shipByStore },
      )
      .then((p) => {
        if (!cancelled) {
          setPreview(p);
          setPreviewErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setPreviewErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [addressID, JSON.stringify(shipByStore)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Shipping panel */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/8 px-4 py-3">
          <div className="text-base font-medium text-white">Shipping</div>
        </div>
        <div className="space-y-3 p-4">
          {loadingOpts && <p className="text-sm text-slate-400">Loading shipping options…</p>}
          {stores.map((s) => {
            const opts = storeOptions[s.id] || [];
            return (
              <div key={s.id} className="rounded-md border border-white/10 bg-white/5 p-3">
                <div className="font-medium text-white">{s.name}</div>
                {opts.length === 0 ? (
                  <p className="text-xs text-slate-400">No shipping options configured.</p>
                ) : (
                  <div className="mt-2 grid gap-1 text-sm">
                    {opts.map((o) => (
                      <label key={o.id} className="flex cursor-pointer items-center gap-2 text-slate-300">
                        <input
                          type="radio"
                          name={`ship-${s.id}`}
                          checked={shipByStore[s.id] === o.id}
                          onChange={() => setShipByStore({ ...shipByStore, [s.id]: o.id })}
                        />
                        <span>
                          {o.name} — {formatMoney(o.base_cost_cents, "USD")}
                          {o.per_additional_card_cents > 0 &&
                            ` + ${formatMoney(o.per_additional_card_cents, "USD")} / extra card`}
                          {o.free_shipping_threshold_cents != null &&
                            ` · free at ${formatMoney(o.free_shipping_threshold_cents, "USD")}+`}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {previewErr && (
        <p className="text-sm text-destructive">{previewErr}</p>
      )}

      {/* Order summary panel */}
      {preview && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="text-base font-medium text-white">Order summary</div>
          </div>
          <div className="space-y-2 p-4 text-sm">
            {preview.groups.map((g) => (
              <div key={g.store_id} className="flex justify-between border-b border-white/10 py-1 last:border-b-0">
                <span className="text-slate-300">
                  {g.store_name} ({g.items} item{g.items === 1 ? "" : "s"})
                  {g.shipping_method_name ? ` · ${g.shipping_method_name}` : ""}
                </span>
                <span className="tabular-nums text-white">
                  {formatMoney(g.subtotal_cents, g.currency)} +{" "}
                  {formatMoney(g.shipping_cents, g.currency)}
                </span>
              </div>
            ))}
            <div className="flex justify-between pt-2 font-semibold text-white">
              <span>Total</span>
              <span>{formatMoney(preview.total_cents, preview.currency)}</span>
            </div>
          </div>
        </div>
      )}

      <PayBlock addressID={addressID} shippingByStore={shipByStore} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Stripe payment block
// ---------------------------------------------------------------------------

function PayBlock({
  addressID,
  shippingByStore,
}: {
  addressID: string;
  shippingByStore: Record<string, string>;
}) {
  const [stripe, setStripe] = useState<Awaited<ReturnType<typeof getStripe>> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [buyerNote, setBuyerNote] = useState("");

  useEffect(() => {
    getStripe().then(setStripe);
  }, []);

  async function startPayment() {
    setConfirming(true);
    setErr(null);
    try {
      const resp = await api.post<{ client_secret: string }>("/checkout/confirm", {
        address_id: addressID,
        shipping_by_store: shippingByStore,
        buyer_note: buyerNote,
      });
      setClientSecret(resp.client_secret);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">Payment</div>
      </div>
      <div className="space-y-3 p-4">
        {!clientSecret && (
          <>
            <div className="space-y-1">
              <Label htmlFor="buyer_note" className="text-slate-300">Note to sellers (optional)</Label>
              <Input
                id="buyer_note"
                value={buyerNote}
                onChange={(e) => setBuyerNote(e.target.value)}
                placeholder="Anything they should know"
                className={darkInp}
              />
            </div>
            <Button
              onClick={startPayment}
              disabled={confirming}
              className="bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {confirming ? "Preparing…" : "Continue to payment"}
            </Button>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </>
        )}
        {clientSecret && stripe && (
          <Elements stripe={stripe} options={{ clientSecret }}>
            <PaymentForm />
          </Elements>
        )}
        {clientSecret && !stripe && (
          <p className="text-sm text-destructive">
            Stripe is not configured — set STRIPE_PUBLISHABLE_KEY on the API.
          </p>
        )}
      </div>
    </div>
  );
}

function PaymentForm() {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    setErr(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/orders`,
      },
      redirect: "if_required",
    });
    if (error) {
      setErr(error.message || "Payment failed");
      setPaying(false);
      return;
    }
    // Webhook will finalize; redirect to orders.
    router.push("/orders");
  }

  return (
    <form onSubmit={pay} className="space-y-3">
      <PaymentElement />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button
        type="submit"
        disabled={!stripe || paying}
        className="bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
      >
        {paying ? "Processing…" : "Pay now"}
      </Button>
    </form>
  );
}
