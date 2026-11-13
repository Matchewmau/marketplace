import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Suspense } from "react";

import { SellerPaymentsPanel } from "@/components/marketplace/seller-payments-panel";

export const metadata: Metadata = {
  title: "Get paid | Marketplace",
};

export default function SellerPaymentsPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link
        href="/"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Marketplace
      </Link>
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
        <SellerPaymentsPanel />
      </Suspense>
    </div>
  );
}
