import { NextResponse } from "next/server";
import Stripe from "stripe";

import { normalizeSellerEmail } from "@/lib/seller-claim";
import { StripeConfigError } from "@/lib/stripe/config";
import {
  refreshSellerAccount,
  safeErrorMessage,
  toPublicSellerStatus,
  unbindSellerAccount,
} from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LOAD_ERROR = "Could not load payout settings.";
const LOG_PREFIX = "stripe connect status failed:";
const NO_STORE = { "Cache-Control": "no-store" };

function serverError(message: string) {
  console.error(LOG_PREFIX, message);
  return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
}

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
    return serverError(safeErrorMessage(err));
  }
  if (!admin) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  try {
    const status = await refreshSellerAccount(stripe, admin, email);
    return NextResponse.json(
      { status: status ? toPublicSellerStatus(status) : null },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      // Only a bound account is ever retrieved, so a missing resource means the binding is stale.
      if (err.code === "resource_missing") {
        try {
          await unbindSellerAccount(admin, email);
        } catch (unbindErr) {
          return serverError(safeErrorMessage(unbindErr));
        }
        return NextResponse.json({ status: null }, { headers: NO_STORE });
      }
      console.error(LOG_PREFIX, safeErrorMessage(err), {
        type: err.type,
        code: err.code,
      });
      return NextResponse.json({ error: "Could not reach Stripe. Try again." }, { status: 502 });
    }
    return serverError(safeErrorMessage(err));
  }
}
