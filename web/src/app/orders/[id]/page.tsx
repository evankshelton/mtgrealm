"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatMoney,
  type Order,
  type OrderItem,
  type OrderMessage,
  type SellerReview,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const darkInp = "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50";

type Resp = {
  order: Order;
  items: OrderItem[];
  messages: OrderMessage[];
  review: SellerReview | null;
  viewer: "buyer" | "seller" | "none";
};

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading, error } = useQuery<Resp>({
    queryKey: ["order", id],
    queryFn: () => api.get(`/orders/${id}`),
    enabled: !!user,
  });

  if (loading || !user) return null;
  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const o = data.order;
  const refresh = () => qc.invalidateQueries({ queryKey: ["order", id] });

  return (
    <div className="space-y-6">
      <Link
        href={data.viewer === "seller" ? "/store/orders" : "/orders"}
        className="text-sm text-slate-400 hover:text-white hover:underline"
      >
        ← Back to orders
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">
          Order from {o.store_name}
        </h1>
        <p className="text-sm text-slate-400">
          Placed {new Date(o.created_at).toLocaleString()} · Status:{" "}
          <span className="font-medium text-white">{o.status}</span>
          {o.payment_status !== "succeeded" && ` (payment: ${o.payment_status})`}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Items panel */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="text-base font-medium text-white">Items</div>
          </div>
          <div className="space-y-0 p-4">
            {data.items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 border-b border-white/10 pb-3 pt-3 first:pt-0 last:border-b-0 last:pb-0">
                {it.image_uri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image_uri} alt={it.card_name} className="h-16 w-auto rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{it.card_name}</div>
                  <div className="text-xs text-slate-400">
                    {it.set_name} ({it.set_code?.toUpperCase()}) · {it.card_condition} · {it.finish} ·{" "}
                    {it.lang}
                  </div>
                </div>
                <div className="text-right text-sm tabular-nums text-slate-300">
                  {it.quantity} × {formatMoney(it.unit_price_cents, o.currency)}
                </div>
              </div>
            ))}
            <div className="space-y-1 pt-3 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span className="tabular-nums text-white">{formatMoney(o.subtotal_cents, o.currency)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Shipping ({o.shipping_method_name ?? "—"})</span>
                <span className="tabular-nums text-white">{formatMoney(o.shipping_cents, o.currency)}</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2 font-semibold text-white">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(o.total_cents, o.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Shipping panel */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="text-base font-medium text-white">Shipping</div>
          </div>
          <div className="space-y-3 p-4 text-sm">
            <div>
              <div className="font-medium text-white">Ship to</div>
              <div className="text-slate-400">
                {o.ship_to_recipient}<br />
                {o.ship_to_line1}{o.ship_to_line2 ? `, ${o.ship_to_line2}` : ""}<br />
                {o.ship_to_city}, {o.ship_to_region} {o.ship_to_postal_code}, {o.ship_to_country}
              </div>
            </div>
            {o.ship_from_recipient && (
              <div>
                <div className="font-medium text-white">Ships from</div>
                <div className="text-slate-400">
                  {o.ship_from_recipient}<br />
                  {o.ship_from_line1}{o.ship_from_line2 ? `, ${o.ship_from_line2}` : ""}<br />
                  {o.ship_from_city}, {o.ship_from_region} {o.ship_from_postal_code}, {o.ship_from_country}
                </div>
              </div>
            )}
            {o.tracking_number && (
              <div>
                <div className="font-medium text-white">Tracking</div>
                <div className="text-slate-400">
                  {o.tracking_carrier ? `${o.tracking_carrier} · ` : ""}
                  {o.tracking_number}
                </div>
              </div>
            )}
            {o.buyer_note && (
              <div>
                <div className="font-medium text-white">Note from buyer</div>
                <div className="text-slate-400 whitespace-pre-line">{o.buyer_note}</div>
              </div>
            )}
            {o.refund_note && (
              <div>
                <div className="font-medium text-white">Refund note</div>
                <div className="text-slate-400 whitespace-pre-line">{o.refund_note}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {data.viewer === "seller" && (
        <SellerActions order={o} refresh={refresh} />
      )}
      {data.viewer === "buyer" && (
        <BuyerActions order={o} refresh={refresh} />
      )}

      <MessagesSection orderID={id} messages={data.messages} userID={user.id} refresh={refresh} />

      {data.viewer === "buyer" && (o.status === "delivered" || o.status === "closed") && (
        <ReviewSection orderID={id} existing={data.review} refresh={refresh} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SellerActions({ order, refresh }: { order: Order; refresh: () => void }) {
  const [carrier, setCarrier] = useState(order.tracking_carrier ?? "");
  const [tracking, setTracking] = useState(order.tracking_number ?? "");
  const [refundNote, setRefundNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string, body?: object) {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/orders/${order.id}/${path}`, body);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">Seller actions</div>
      </div>
      <div className="space-y-3 p-4">
        {order.status === "paid" && (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="carrier" className="text-slate-300">Carrier</Label>
                <Input id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="USPS" className={darkInp} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tracking" className="text-slate-300">Tracking number</Label>
                <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} className={darkInp} />
              </div>
              <Button
                disabled={busy}
                onClick={() => call("ship", { tracking_carrier: carrier, tracking_number: tracking })}
                className="bg-amber-500 text-black hover:bg-amber-400"
              >
                Mark shipped
              </Button>
            </div>
          </div>
        )}
        {(order.status === "pending" || order.status === "paid") && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => call("cancel")}
            className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            Cancel order
          </Button>
        )}
        {(order.status === "paid" || order.status === "shipped" || order.status === "delivered") && (
          <div className="space-y-2 border-t border-white/10 pt-3">
            <div className="space-y-1">
              <Label htmlFor="refund-note" className="text-slate-300">Refund note</Label>
              <Input
                id="refund-note"
                value={refundNote}
                onChange={(e) => setRefundNote(e.target.value)}
                placeholder="Reason — process the refund in Stripe Dashboard"
                className={darkInp}
              />
            </div>
            <Button variant="destructive" disabled={busy} onClick={() => call("refund", { note: refundNote })}>
              Mark refunded
            </Button>
            <p className="text-xs text-slate-500">
              Then process the actual refund in your Stripe dashboard.
            </p>
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </div>
  );
}

function BuyerActions({ order, refresh }: { order: Order; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string) {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/orders/${order.id}/${path}`);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (order.status === "shipped") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-slate-300">When the package arrives, mark it received so the seller can be paid out.</p>
          <Button disabled={busy} onClick={() => call("deliver")} className="bg-amber-500 text-black hover:bg-amber-400">
            Mark as received
          </Button>
        </div>
        {err && <p className="px-4 pb-3 text-sm text-destructive">{err}</p>}
      </div>
    );
  }
  if (order.status === "pending") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-slate-300">Your payment hasn&apos;t been confirmed yet.</p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => call("cancel")}
            className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            Cancel order
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

function MessagesSection({
  orderID,
  messages,
  userID,
  refresh,
}: {
  orderID: string;
  messages: OrderMessage[];
  userID: string;
  refresh: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await api.post(`/orders/${orderID}/messages`, { body });
      setBody("");
      refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">Messages</div>
      </div>
      <div className="space-y-3 p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet.</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-md border border-white/10 p-2 text-sm ${
                  m.sender_id === userID ? "bg-white/10" : "bg-transparent"
                }`}
              >
                <div className="text-xs text-slate-400">
                  {m.sender_name || (m.sender_id === userID ? "You" : "Other party")} ·{" "}
                  {new Date(m.created_at).toLocaleString()}
                </div>
                <div className="whitespace-pre-line text-slate-300">{m.body}</div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message…"
            className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50"
          />
          <Button
            disabled={sending || !body.trim()}
            onClick={send}
            className="bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewSection({
  orderID,
  existing,
  refresh,
}: {
  orderID: string;
  existing: SellerReview | null;
  refresh: () => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [body, setBody] = useState(existing?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await api.post(`/orders/${orderID}/review`, { rating, body });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-base font-medium text-white">
          {existing ? "Your review" : "Leave a review"}
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-1 text-2xl">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              className={n <= rating ? "text-yellow-500" : "text-slate-400"}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
            >
              ★
            </button>
          ))}
        </div>
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Tell future buyers what worked / what could be better"
          className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50"
        />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button
          disabled={saving}
          onClick={submit}
          className="bg-amber-500 text-black hover:bg-amber-400"
        >
          {saving ? "Saving…" : existing ? "Update review" : "Submit review"}
        </Button>
      </div>
    </div>
  );
}
