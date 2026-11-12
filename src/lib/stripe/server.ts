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

function parseHttpOrigin(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    // not a URL
  }
  return null;
}

function parseVercelHost(host: string | undefined): string | null {
  const trimmed = host?.trim();
  return trimmed ? parseHttpOrigin(`https://${trimmed}`) : null;
}

/** Origin for building redirect URLs: a valid APP_URL wins, otherwise the request origin. */
export function getAppOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  return parseHttpOrigin(env.APP_URL) ?? new URL(request.url).origin;
}

/**
 * Origin to return Checkout buyers to. The browser's Origin header wins when it is one of this
 * app's known origins (request origin, APP_URL, Vercel deployment URLs), so per-origin storage
 * still works; otherwise a valid APP_URL, otherwise the request origin. Never returns an origin
 * outside that set.
 */
export function getCheckoutReturnOrigin(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const requestOrigin = new URL(request.url).origin;
  const appUrlOrigin = parseHttpOrigin(env.APP_URL);
  const allowed = new Set<string>([requestOrigin]);
  for (const origin of [
    appUrlOrigin,
    parseVercelHost(env.VERCEL_URL),
    parseVercelHost(env.VERCEL_BRANCH_URL),
    parseVercelHost(env.VERCEL_PROJECT_PRODUCTION_URL),
  ]) {
    if (origin) allowed.add(origin);
  }

  const browserOrigin = parseHttpOrigin(request.headers.get("origin"));
  if (browserOrigin && allowed.has(browserOrigin)) {
    return browserOrigin;
  }
  return appUrlOrigin ?? requestOrigin;
}
