import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { cancelCheckoutHold } from "@/lib/checkout";
import { StripeConfigError } from "@/lib/stripe/config";
import { safeErrorMessage } from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";

const LOG_PREFIX = "checkout cancel route failed:";
const NOT_CONFIGURED = "Payments are not configured.";

/** Cancels the buyer's checkout. The hold token comes in the body, never in a URL. */
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
  const { listingId, holdToken } = record;
  if (
    typeof listingId !== "string" ||
    typeof holdToken !== "string" ||
    !isUuid(listingId) ||
    !isUuid(holdToken)
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    console.error(LOG_PREFIX, safeErrorMessage(err));
    return NextResponse.json({ error: "Could not cancel checkout." }, { status: 500 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  // cancelCheckoutHold never throws; failures come back as "unknown".
  const result = await cancelCheckoutHold(listingId, holdToken, { stripe, admin });
  return NextResponse.json({ result });
}
