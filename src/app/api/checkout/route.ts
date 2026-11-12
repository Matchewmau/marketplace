import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { createCheckoutForListing } from "@/lib/checkout";
import { readStripeEnv, StripeConfigError } from "@/lib/stripe/config";
import { safeErrorMessage } from "@/lib/stripe/connect";
import { getRequestOrigin, getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LOG_PREFIX = "checkout route failed:";
const NOT_CONFIGURED = "Payments are not configured.";

function serverError(message: string) {
  console.error(LOG_PREFIX, message);
  return NextResponse.json({ error: "Could not start checkout. Try again." }, { status: 500 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const record = typeof body === "object" && body !== null
    ? (body as { listingId?: unknown; holdToken?: unknown })
    : {};

  let stripe: Stripe;
  let feeBps: number;
  try {
    stripe = getStripe();
    feeBps = readStripeEnv().platformFeeBps;
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    return serverError(safeErrorMessage(err));
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  try {
    const result = await createCheckoutForListing(
      typeof record.listingId === "string" ? record.listingId : "",
      getRequestOrigin(request),
      { stripe, admin, feeBps },
      typeof record.holdToken === "string" ? record.holdToken : undefined,
    );
    if (result.ok) {
      return NextResponse.json({ url: result.url, holdToken: result.holdToken });
    }
    return NextResponse.json(
      { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
      { status: result.status },
    );
  } catch (err) {
    return serverError(safeErrorMessage(err));
  }
}
