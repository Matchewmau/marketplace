import { NextResponse } from "next/server";
import Stripe from "stripe";

import { normalizeSellerEmail } from "@/lib/seller-claim";
import { StripeConfigError } from "@/lib/stripe/config";
import { refreshSellerAccount } from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LOAD_ERROR = "Could not load payout settings.";

export async function GET(request: Request) {
  const email = normalizeSellerEmail(new URL(request.url).searchParams.get("email"));
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
    }
    return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
  }
  if (!admin) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  try {
    const status = await refreshSellerAccount(stripe, admin, email);
    return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error("stripe connect status failed", {
        type: err.type,
        code: err.code,
        message: err.message,
      });
      return NextResponse.json({ error: "Could not reach Stripe. Try again." }, { status: 502 });
    }
    return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
  }
}
