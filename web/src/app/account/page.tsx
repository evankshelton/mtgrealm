"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function AccountPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Account</h1>
        <p className="text-sm text-slate-400">{user.email}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <DashCard title="Purchases" href="/orders" description="Orders you've placed as a buyer." />
        <DashCard title="Addresses" href="/account/addresses" description="Saved shipping addresses for checkout." />
      </div>
    </div>
  );
}

function DashCard({ title, href, description }: { title: string; href: string; description: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/5"
    >
      <div className="text-base font-medium text-white">{title}</div>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
    </Link>
  );
}
