"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, ShoppingCart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api, type CartLine } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const links = [
  { href: "/collection", label: "Collection" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/store", label: "Store" },
];

export function Nav() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [marketQ, setMarketQ] = useState("");

  function handleMarketSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = marketQ.trim();
    router.push(q ? `/marketplace?q=${encodeURIComponent(q)}` : "/marketplace");
  }

  const { data: cartData } = useQuery<{ items: CartLine[] }>({
    queryKey: ["cart"],
    queryFn: () => api.get("/cart"),
    enabled: !!user,
  });
  const cartCount = cartData?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  return (
    <header className="border-b border-white/10 bg-background">
      <div className="container flex h-14 items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight">
          mtg
        </Link>

        {!loading && user && (
          <nav className="flex items-center gap-1">
            {links.map((l) => (
              <Button key={l.href} asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link href={l.href}>{l.label}</Link>
              </Button>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2 text-sm">
          {!loading && user && (
            <Button asChild variant="ghost" size="icon" className="relative">
              <Link href="/cart">
                <ShoppingCart className="h-4 w-4" />
                {cartCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {cartCount}
                  </span>
                )}
              </Link>
            </Button>
          )}
          {loading ? null : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1">
                  {user.display_name || user.email}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/account">Account</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    await signOut();
                    router.push("/");
                  }}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Marketplace search bar ── */}
      <div className="border-t border-white/[0.06] bg-[#17122a]">
        <form onSubmit={handleMarketSearch} className="mx-auto flex h-12 max-w-2xl items-center gap-2 px-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              value={marketQ}
              onChange={(e) => setMarketQ(e.target.value)}
              placeholder="Search marketplace…"
              className="h-9 w-full rounded-md border border-white/10 bg-white/[0.06] pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md border border-amber-500/30 px-4 text-sm font-medium text-amber-400 transition-colors hover:border-amber-500/50 hover:bg-amber-500/10"
          >
            Search
          </button>
        </form>
      </div>
    </header>
  );
}
