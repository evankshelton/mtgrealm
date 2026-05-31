"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.display_name || user.email}</h1>
        <p className="text-muted-foreground">Pick up where you left off.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DashCard title="Collection" href="/collection" description="Track what you own." />
        <DashCard title="Decks" href="/decks" description="Build and edit decks." />
        <DashCard title="Store" href="/store" description="Marketplace seller settings." />
        <DashCard title="Browse" href="/cards" description="Search every printing." />
      </div>
    </div>
  );
}

function DashCard({ title, href, description }: { title: string; href: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <Link href={href} className="hover:underline">
            {title}
          </Link>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
