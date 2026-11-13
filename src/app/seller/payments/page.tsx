import type { Metadata } from "next";
import { Suspense } from "react";

import { BackLink } from "@/components/layout/back-link";
import { StripeConfigError, readPlatformFeeBps } from "@/lib/stripe/config";
import { SellerPaymentsPanel } from "@/components/marketplace/seller-payments-panel";

export const metadata: Metadata = {
  title: "Get paid | Marketplace",
};

export default function SellerPaymentsPage() {
  let platformFeeBps: number | null;
  try {
    platformFeeBps = readPlatformFeeBps();
  } catch (error) {
    if (!(error instanceof StripeConfigError)) throw error;
    platformFeeBps = null;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <BackLink />
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Get paid</h1>
        <p className="mt-1 text-sm text-gray-600">
          Connect a Stripe account so buyers can pay for your listings.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="rounded-xl bg-white p-6 text-sm text-gray-500 shadow-sm ring-1 ring-black/[0.03]">
            Loading…
          </div>
        }
      >
        <SellerPaymentsPanel platformFeeBps={platformFeeBps} />
      </Suspense>
    </div>
  );
}
