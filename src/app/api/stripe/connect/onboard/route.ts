import { NextResponse } from "next/server";
import Stripe from "stripe";

import { decideOnboarding, normalizeSellerEmail } from "@/lib/seller-claim";
import { StripeConfigError } from "@/lib/stripe/config";
import {
  createOnboardingLink,
  createSellerAccount,
  refreshSellerAccount,
} from "@/lib/stripe/connect";
import { getAppOrigin, getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type SellerAccountRow = { stripe_account_id: string; details_submitted: boolean };

const LOAD_ERROR = "Could not load payout settings.";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = normalizeSellerEmail(
    typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined,
  );
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

  const loadRow = async () =>
    admin
      .from("seller_accounts")
      .select("stripe_account_id, details_submitted")
      .eq("seller_email", email)
      .maybeSingle();

  try {
    const { data: row, error } = await loadRow();
    if (error) {
      return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
    }

    let decision = decideOnboarding((row as SellerAccountRow | null) ?? null);
    let accountId: string;

    if (decision.action === "create") {
      accountId = await createSellerAccount(stripe, email);
      const { error: insertError } = await admin
        .from("seller_accounts")
        .insert({ seller_email: email, stripe_account_id: accountId });

      if (insertError) {
        if (insertError.code !== "23505") {
          return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
        }
        // Another request bound this email first; the account just created is an orphan (sandbox only).
        console.warn("stripe connect onboard: orphaned connected account after claim race", {
          accountId,
        });
        const { data: winner, error: reloadError } = await loadRow();
        if (reloadError || !winner) {
          return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
        }
        decision = decideOnboarding(winner as SellerAccountRow);
        if (decision.action === "create") {
          return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
        }
        accountId = decision.accountId;
      }
    } else {
      accountId = decision.accountId;
    }

    if (decision.action === "status_only") {
      const status = await refreshSellerAccount(stripe, admin, email);
      return NextResponse.json({ status });
    }

    const url = await createOnboardingLink(stripe, accountId, getAppOrigin(request));
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error("stripe connect onboard failed", {
        type: err.type,
        code: err.code,
        message: err.message,
      });
      return NextResponse.json({ error: "Could not reach Stripe. Try again." }, { status: 502 });
    }
    return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
  }
}
