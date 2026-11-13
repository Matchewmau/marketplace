import Link from "next/link";
import type { ReactNode } from "react";
import Stripe from "stripe";

import { ClearHoldToken } from "@/components/marketplace/clear-hold-token";
import { fulfillCheckoutSession, type FulfillResult } from "@/lib/fulfillment";
import { AppScopeUnavailableError } from "@/lib/stripe/app-scope";
import { safeErrorMessage } from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const SESSION_ID_PATTERN = /^cs_(test_)?[A-Za-z0-9]+$/;

type SuccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

function Panel({
  title,
  listingId,
  children,
}: {
  title: string;
  listingId?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]">
        <h1 className="text-2xl font-semibold text-gray-800">{title}</h1>
        {children}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {listingId && (
            <Link
              href={`/item/${listingId}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-gray-200 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Back to item
            </Link>
          )}
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md bg-brand-strong px-4 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            Back to Marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm text-gray-600">{children}</p>;
}

export default async function CheckoutSuccessPage({ searchParams }: SuccessPageProps) {
  const params = await searchParams;
  const sessionId = typeof params.session_id === "string" ? params.session_id : "";

  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return (
      <Panel title="Checkout not found">
        <Message>We couldn&apos;t find that checkout.</Message>
      </Panel>
    );
  }

  let stripe: Stripe | null = null;
  try {
    stripe = getStripe();
  } catch {
    stripe = null;
  }
  const admin = getSupabaseAdmin();
  if (!stripe || !admin) {
    return (
      <Panel title="Payments unavailable">
        <Message>Online payments are temporarily unavailable.</Message>
      </Panel>
    );
  }

  let result: FulfillResult;
  try {
    result = await fulfillCheckoutSession(sessionId, { stripe, admin });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError && err.code === "resource_missing") {
      return (
        <Panel title="Checkout not found">
          <Message>We couldn&apos;t find that checkout.</Message>
        </Panel>
      );
    }
    // AppScopeUnavailableError included: the payment is kept and settled once the scope is fixed.
    console.error(
      "checkout success failed:",
      err instanceof AppScopeUnavailableError ? "app scope unavailable" : safeErrorMessage(err),
    );
    return (
      <Panel title="Confirming your payment">
        <Message>We&apos;re confirming your payment. Refresh this page in a moment.</Message>
      </Panel>
    );
  }

  const { outcome, listingId, amountCents } = result;

  if (outcome === "ignored") {
    return (
      <Panel title="Checkout not found">
        <Message>We couldn&apos;t find that checkout.</Message>
      </Panel>
    );
  }

  if (outcome === "refunded") {
    return (
      <Panel title="Item already sold" listingId={listingId}>
        <Message>This item was already sold. Your payment has been refunded.</Message>
        {listingId && <ClearHoldToken listingId={listingId} />}
      </Panel>
    );
  }

  if (outcome === "refunded_unavailable") {
    return (
      <Panel title="Item no longer available">
        <Message>This item is no longer available. Your payment has been refunded.</Message>
        {listingId && <ClearHoldToken listingId={listingId} />}
      </Panel>
    );
  }

  if (outcome === "not_paid") {
    return (
      <Panel title="Payment processing" listingId={listingId}>
        <Message>Your payment is processing. Refresh this page in a moment.</Message>
      </Panel>
    );
  }

  let title: string | null = null;
  if (listingId) {
    const { data, error } = await admin
      .from("listings")
      .select("title")
      .eq("id", listingId)
      .maybeSingle();
    if (error) {
      console.error("checkout success listing load failed:", safeErrorMessage(error.message));
    } else if (data) {
      title = (data as { title: string }).title;
    }
  }

  return (
    <Panel title="Order confirmed" listingId={listingId}>
      {title && <p className="mt-4 text-base font-medium text-gray-800">{title}</p>}
      {amountCents !== null && (
        <p className="mt-1 text-lg font-semibold text-gray-900">{formatCents(amountCents)}</p>
      )}
      <Message>Your payment went through. The seller will see this order.</Message>
      {listingId && <ClearHoldToken listingId={listingId} />}
    </Panel>
  );
}
