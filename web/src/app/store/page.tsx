"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Tag, ShoppingBag, DollarSign, CheckCircle2, Plus, ArrowRight } from "lucide-react";
import { api, formatMoney, type Store, type MarketplaceListing, type Order } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-yellow-900/40 text-yellow-400",
  paid:      "bg-blue-900/40 text-blue-400",
  shipped:   "bg-purple-900/40 text-purple-400",
  delivered: "bg-emerald-900/40 text-emerald-400",
  closed:    "bg-white/5 text-slate-400",
  cancelled: "bg-red-900/40 text-red-400",
  refunded:  "bg-red-900/40 text-red-400",
};

export default function StoreDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data: store, error: storeError, isLoading: storeLoading } = useQuery<Store>({
    queryKey: ["my-store"],
    queryFn: () => api.get("/store"),
    enabled: !!user,
    retry: false,
  });

  const { data: listingsData } = useQuery<{ data: MarketplaceListing[] }>({
    queryKey: ["store-listings"],
    queryFn: () => api.get("/store/listings"),
    enabled: !!store,
  });

  const { data: ordersData } = useQuery<{ data: Order[] }>({
    queryKey: ["orders", "seller"],
    queryFn: () => api.get("/orders?scope=seller"),
    enabled: !!store,
  });

  if (loading || !user) return null;
  if (storeLoading) return <p className="text-sm text-slate-400">Loading…</p>;

  if (storeError && (storeError as { status?: number }).status === 404) {
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Set up your store</h1>
          <p className="mt-1 text-sm text-slate-400">
            Create a store to list cards from your collection and sell to other players.
          </p>
        </div>
        <Button asChild className="bg-amber-500 text-black hover:bg-amber-400">
          <Link href="/store/settings">
            <Plus className="mr-1.5 h-4 w-4" /> Create your store
          </Link>
        </Button>
      </div>
    );
  }

  const listings = listingsData?.data ?? [];
  const orders   = ordersData?.data ?? [];

  const activeListings = listings.filter((l) => l.status === "active").length;
  const pendingOrders  = orders.filter((o) => o.status === "pending" || o.status === "paid").length;
  const totalOrders    = orders.length;
  const revenue        = orders
    .filter((o) => o.payment_status === "paid" && o.status !== "cancelled" && o.status !== "refunded")
    .reduce((s, o) => s + o.total_cents, 0);
  const currency = store?.default_currency ?? "USD";

  const recentOrders = [...orders]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const recentListings = [...listings]
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{store?.name}</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {store?.store_type === "lgs" ? "Local game store" : "Personal store"}
          </p>
        </div>
        <Button asChild size="sm" className="bg-amber-500 text-black hover:bg-amber-400">
          <Link href="/store/listings">
            <Plus className="mr-1.5 h-4 w-4" /> New listing
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Active listings" value={activeListings} icon={<Tag className="h-4 w-4" />} sub={`${listings.length} total`} href="/store/listings" />
        <StatCard
          title="Pending orders"
          value={pendingOrders}
          icon={<ShoppingBag className="h-4 w-4" />}
          sub={pendingOrders === 1 ? "needs attention" : pendingOrders > 0 ? "need attention" : "all clear"}
          href="/store/orders"
          highlight={pendingOrders > 0}
        />
        <StatCard title="Total revenue" value={formatMoney(revenue, currency)} icon={<DollarSign className="h-4 w-4" />} sub="from paid orders" href="/store/orders" />
        <StatCard
          title="Orders fulfilled"
          value={orders.filter((o) => o.status === "delivered" || o.status === "closed").length}
          icon={<CheckCircle2 className="h-4 w-4" />}
          sub={`${totalOrders} total`}
          href="/store/orders"
        />
      </div>

      {/* Two-column detail */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent orders */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <span className="text-sm font-medium text-white">Recent orders</span>
            <Link href="/store/orders" className="flex items-center gap-1 text-xs text-slate-400 hover:text-white">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-0.5 p-2">
            {recentOrders.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No orders yet.</p>
            ) : (
              recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate font-medium text-white">{o.buyer_name || o.buyer_email}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {new Date(o.created_at).toLocaleDateString()}
                      {" · "}{o.item_count} item{o.item_count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[o.status] ?? "bg-white/5 text-slate-400"}`}>
                      {o.status}
                    </span>
                    <span className="tabular-nums text-xs font-medium text-slate-300">{formatMoney(o.total_cents, o.currency)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent listings */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <span className="text-sm font-medium text-white">Recent listings</span>
            <Link href="/store/listings" className="flex items-center gap-1 text-xs text-slate-400 hover:text-white">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-0.5 p-2">
            {recentListings.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                No listings yet.{" "}
                <Link href="/store/listings" className="underline">Create one →</Link>
              </p>
            ) : (
              recentListings.map((l) => (
                <Link
                  key={l.id}
                  href={`/store/listings/${l.id}`}
                  className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-white/5"
                >
                  {l.image_uris?.small ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image_uris.small as string} alt={l.card_name} className="h-10 w-auto rounded shadow-sm" />
                  ) : (
                    <div className="h-10 w-7 rounded bg-white/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{l.card_name}</p>
                    <p className="text-xs text-slate-400">{l.card_condition} · {l.finish}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold tabular-nums text-slate-300">{formatMoney(l.price_cents, l.currency)}</p>
                    <p className={`text-[10px] font-medium ${l.status === "active" ? "text-emerald-400" : "text-slate-400"}`}>
                      {l.status}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title, value, icon, sub, href, highlight = false,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  sub: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link href={href}>
      <div className={`rounded-xl border bg-white/[0.03] p-4 transition-colors hover:bg-white/5 ${highlight ? "border-amber-500/40" : "border-white/10"}`}>
        <div className={`inline-flex rounded-md p-2 ${highlight ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-slate-400"}`}>
          {icon}
        </div>
        <p className="mt-3 text-2xl font-bold tabular-nums text-white">{value}</p>
        <p className="text-xs font-medium text-slate-300">{title}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>
      </div>
    </Link>
  );
}
