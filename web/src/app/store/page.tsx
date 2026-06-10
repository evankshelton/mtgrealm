"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, type Store } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SellerDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading, error } = useQuery<Store>({
    queryKey: ["my-store"],
    queryFn: () => api.get("/store"),
    enabled: !!user,
    retry: false,
  });

  if (loading || !user) return null;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  if (error && (error as { status?: number }).status === 404) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Sell on the marketplace</h1>
        <p className="text-muted-foreground">
          Set up your store to list cards from your collection for sale.
        </p>
        <Button asChild>
          <Link href="/store/settings">Create your store</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{data?.name}</h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/marketplace/stores/${data?.slug}`} className="hover:underline">
            View public page →
          </Link>
          {" · "}status {data?.status}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <DashCard title="Listings" href="/store/listings" description="Create from your collection, edit, pause." />
        <DashCard title="Orders" href="/store/orders" description="Fulfillment, tracking, refunds." />
        <DashCard title="Shipping" href="/store/shipping" description="Methods you offer + flat-rate pricing." />
        <DashCard title="Settings" href="/store/settings" description="Profile, return policy, ship-from address." />
        <DashCard title="Addresses" href="/account/addresses" description="Your shipping addresses (for buying)." />
      </div>
    </div>
  );
}

function DashCard({ title, href, description }: { title: string; href: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <Link href={href} className="hover:underline">{title}</Link>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
