"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { api } from "@/lib/api";

// Cached Stripe instance keyed by publishable key. Loaded lazily because
// the publishable key comes from the API (so we never hard-code it).
let stripePromise: Promise<Stripe | null> | null = null;

export async function getStripe(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  const cfg = await api.get<{ publishable_key: string; currency: string }>(
    "/stripe/config",
  );
  if (!cfg.publishable_key) return Promise.resolve(null);
  stripePromise = loadStripe(cfg.publishable_key);
  return stripePromise;
}
