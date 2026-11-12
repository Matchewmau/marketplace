import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getAppScope } from "@/lib/stripe/app-scope";
import { readStripeEnv } from "@/lib/stripe/config";
import { safeErrorMessage } from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/server";
import { handleStripeEvent } from "@/lib/stripe/webhook-handler";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LOG_PREFIX = "stripe webhook failed:";
const NOT_CONFIGURED = "Payments are not configured.";

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  let stripe: Stripe;
  let webhookSecret: string | null;
  try {
    webhookSecret = readStripeEnv().webhookSecret;
    stripe = getStripe();
  } catch (err) {
    console.error(LOG_PREFIX, safeErrorMessage(err));
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }
  const admin = getSupabaseAdmin();
  if (!webhookSecret || !admin) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error(LOG_PREFIX, safeErrorMessage(err));
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Checked after the signature so unsigned requests get 400 and do not log scope errors. Without
  // a scope no session can be matched; a 503 makes Stripe retry for a limited time (a few hours in
  // a sandbox, up to 3 days live), so resend failed events after fixing it.
  if (!getAppScope()) {
    console.error(LOG_PREFIX, "app scope unavailable");
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  try {
    await handleStripeEvent(event, { stripe, admin });
  } catch (err) {
    // A 500 makes Stripe retry delivery; fulfilment is idempotent.
    console.error(LOG_PREFIX, event.type, safeErrorMessage(err));
    return NextResponse.json({ error: "Webhook handling failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
