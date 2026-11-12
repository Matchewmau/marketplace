import { NextResponse } from "next/server";
import Stripe from "stripe";

import { decideOnboarding, normalizeSellerEmail } from "@/lib/seller-claim";
import { StripeConfigError } from "@/lib/stripe/config";
import {
  createOnboardingLink,
  createSellerAccount,
  refreshSellerAccount,
  safeErrorMessage,
  SellerAccountMissingError,
  toPublicSellerStatus,
  unbindSellerAccount,
} from "@/lib/stripe/connect";
import { getAppOrigin, getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { SellerPaymentStatus } from "@/lib/types";

export const runtime = "nodejs";

type SellerAccountRow = { stripe_account_id: string; details_submitted: boolean };

const LOAD_ERROR = "Could not load payout settings.";
const LOG_PREFIX = "stripe connect onboard failed:";

function serverError(message: string) {
  console.error(LOG_PREFIX, message);
  return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
}

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

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return serverError(safeErrorMessage(err));
  }
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
  const db = admin;

  const loadRow = async () =>
    db
      .from("seller_accounts")
      .select("stripe_account_id, details_submitted")
      .eq("seller_email", email)
      .maybeSingle();

  // The connected account this email is bound to in seller_accounts, once known.
  let boundAccountId: string | null = null;

  try {
    const { data: row, error } = await loadRow();
    if (error) {
      return serverError(error.message);
    }

    let refreshed: SellerPaymentStatus | null = null;
    if (row) {
      // Re-read from Stripe first: a seller who finished onboarding but never hit the
      // return URL must not be handed a fresh link.
      boundAccountId = (row as SellerAccountRow).stripe_account_id;
      refreshed = await refreshSellerAccount(stripe, db, email);
      if (!refreshed) {
        return serverError("seller account row disappeared during refresh");
      }
    }

    let status: SellerPaymentStatus | null = refreshed;
    let decision = decideOnboarding(refreshed);
    let accountId: string;

    if (decision.action === "create") {
      const created = await createSellerAccount(stripe, email);
      const createdRow: SellerPaymentStatus = { stripe_account_id: created.id, ...created.flags };
      const { error: insertError } = await db
        .from("seller_accounts")
        .insert({ seller_email: email, ...createdRow });

      if (insertError) {
        if (insertError.code !== "23505") {
          return serverError(insertError.message);
        }
        // Another request bound this email first.
        const { data: winner, error: reloadError } = await loadRow();
        if (reloadError || !winner) {
          return serverError(reloadError?.message ?? "claim race winner row not found");
        }
        decision = decideOnboarding(winner as SellerAccountRow);
        if (decision.action === "create") {
          return serverError("claim race produced no bound account");
        }
        if (decision.accountId !== created.id) {
          // The account just created is an orphan (sandbox only).
          console.warn("stripe connect onboard: orphaned connected account after claim race", {
            accountId: created.id,
          });
        }
        accountId = decision.accountId;
      } else {
        // Decide on the flags actually stored: an already-attested account gets no link.
        decision = decideOnboarding(createdRow);
        accountId = created.id;
        status = createdRow;
      }
      boundAccountId = accountId;
    } else {
      accountId = decision.accountId;
    }

    if (decision.action === "status_only") {
      status = status ?? (await refreshSellerAccount(stripe, db, email));
      return NextResponse.json({ status: status ? toPublicSellerStatus(status) : null });
    }

    const url = await createOnboardingLink(stripe, accountId, getAppOrigin(request));
    return NextResponse.json({ url });
  } catch (err) {
    const missingAccountId =
      err instanceof SellerAccountMissingError
        ? err.accountId
        : err instanceof Stripe.errors.StripeError && err.code === "resource_missing"
          ? boundAccountId
          : null;
    if (missingAccountId) {
      try {
        await unbindSellerAccount(db, email, missingAccountId);
      } catch (unbindErr) {
        return serverError(safeErrorMessage(unbindErr));
      }
      return NextResponse.json(
        {
          error: "The Stripe account linked to this email no longer exists. Start setup again.",
        },
        { status: 409 },
      );
    }
    if (err instanceof Stripe.errors.StripeError) {
      console.error(LOG_PREFIX, safeErrorMessage(err), {
        type: err.type,
        code: err.code,
      });
      return NextResponse.json({ error: "Could not reach Stripe. Try again." }, { status: 502 });
    }
    return serverError(safeErrorMessage(err));
  }
}
