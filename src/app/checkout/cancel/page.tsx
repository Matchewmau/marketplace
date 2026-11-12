import Link from "next/link";
import type Stripe from "stripe";

import { ClearHoldToken } from "@/components/marketplace/clear-hold-token";
import { cancelCheckoutHold, type CancelResult } from "@/lib/checkout";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

type CancelPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const COPY: Record<CancelResult, { title: string; message: string }> = {
  cancelled: { title: "Payment cancelled", message: "Payment cancelled. You were not charged." },
  already_paid: { title: "Payment received", message: "This payment already went through." },
  unknown: { title: "Checkout closed", message: "Your checkout was closed." },
};

export default async function CheckoutCancelPage({ searchParams }: CancelPageProps) {
  const params = await searchParams;
  const listing = typeof params.listing === "string" && isUuid(params.listing) ? params.listing : null;
  const hold = typeof params.hold === "string" && isUuid(params.hold) ? params.hold : null;

  let result: CancelResult = "unknown";
  if (listing && hold) {
    let stripe: Stripe | null = null;
    try {
      stripe = getStripe();
    } catch {
      stripe = null;
    }
    const admin = getSupabaseAdmin();
    if (stripe && admin) {
      result = await cancelCheckoutHold(listing, hold, { stripe, admin });
    }
  }
  const copy = COPY[result];

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]">
        <h1 className="text-2xl font-semibold text-gray-800">{copy.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{copy.message}</p>
        <Link
          href={listing ? `/item/${listing}` : "/"}
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-[#1877F2] px-4 text-sm font-medium text-white transition-colors hover:bg-[#166FE5]"
        >
          {listing ? (result === "already_paid" ? "View item" : "Back to item") : "Back to Marketplace"}
        </Link>
        {listing && <ClearHoldToken listingId={listing} />}
      </div>
    </div>
  );
}
