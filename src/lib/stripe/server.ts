import Stripe from "stripe";
import { readStripeEnv } from "@/lib/stripe/config";

export const STRIPE_API_VERSION = "2026-10-28.endive";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (typeof window !== "undefined") {
    throw new Error("The Stripe client is server-only.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(readStripeEnv().secretKey, {
      apiVersion: STRIPE_API_VERSION,
      appInfo: { name: "marketplace" },
    });
  }
  return stripeClient;
}

/** Origin for building redirect URLs: a valid APP_URL wins, otherwise the request origin. */
export function getAppOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.APP_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // fall through to the request origin
    }
  }
  return new URL(request.url).origin;
}

/** Origin the request was made from. Checkout returns buyers here so per-origin storage still works. */
export function getRequestOrigin(request: Request): string {
  return new URL(request.url).origin;
}
