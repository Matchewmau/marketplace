import { CancelCheckout } from "@/components/marketplace/cancel-checkout";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

type CancelPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Stripe redirects here when the buyer leaves Checkout. Rendering has no side effects: the client
 * component posts the hold token from sessionStorage to /api/checkout/cancel.
 */
export default async function CheckoutCancelPage({ searchParams }: CancelPageProps) {
  const params = await searchParams;
  const listing = typeof params.listing === "string" && isUuid(params.listing) ? params.listing : null;

  return <CancelCheckout listingId={listing} />;
}
