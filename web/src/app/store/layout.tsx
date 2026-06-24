"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Tag,
  ShoppingBag,
  Truck,
  Settings,
  ExternalLink,
} from "lucide-react";
import { api, type Store } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/store",          label: "Overview",  icon: LayoutDashboard, exact: true },
  { href: "/store/listings", label: "Listings",  icon: Tag },
  { href: "/store/orders",   label: "Orders",    icon: ShoppingBag },
  { href: "/store/shipping", label: "Shipping",  icon: Truck },
  { href: "/store/settings", label: "Settings",  icon: Settings },
];

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  const { data: store } = useQuery<Store>({
    queryKey: ["my-store"],
    queryFn: () => api.get("/store"),
    enabled: !!user,
    retry: false,
  });

  if (loading) return null;

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-3.5rem)] text-white">

      {/* ── Sidebar ── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-white/[0.02]">

        {/* Store identity */}
        <div className="border-b border-white/10 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Store
          </p>
          {store ? (
            <>
              <p className="mt-1 truncate font-semibold leading-tight text-white">{store.name}</p>
              <span
                className={cn(
                  "mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                  store.status === "active"
                    ? "bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-500/30"
                    : "bg-white/5 text-slate-400 ring-1 ring-white/10",
                )}
              >
                {store.status}
              </span>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">No store yet</p>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-white/10 font-medium text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Public store link */}
        {store && (
          <div className="border-t border-white/10 px-4 py-3">
            <Link
              href={`/marketplace/stores/${store.slug}`}
              className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              View public page
            </Link>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-auto px-6 py-6">
        {children}
      </div>
    </div>
  );
}
