import { dollarsToCents, STRIPE_MAX_CHARGE_CENTS, STRIPE_MIN_CHARGE_CENTS } from "@/lib/stripe/amount";
import type { Listing, PurchaseBlockReason, PurchaseState, SellerPaymentStatus } from "@/lib/types";

export type SellerGate = Pick<SellerPaymentStatus, "charges_enabled"> | null;

export function getPurchaseState(
  listing: Pick<Listing, "price" | "status">,
  seller: SellerGate,
  hasActiveHold: boolean,
  paymentsConfigured: boolean,
): PurchaseState {
  if (listing.status === "sold") return { buyable: false, reason: "sold" };

  const cents = dollarsToCents(listing.price);
  if (cents === null) return { buyable: false, reason: "payments_unavailable" };
  if (cents === 0) return { buyable: false, reason: "free" };
  if (cents < STRIPE_MIN_CHARGE_CENTS) return { buyable: false, reason: "below_minimum" };
  if (cents > STRIPE_MAX_CHARGE_CENTS) return { buyable: false, reason: "above_maximum" };
  if (!paymentsConfigured) return { buyable: false, reason: "payments_unavailable" };
  if (!seller?.charges_enabled) return { buyable: false, reason: "seller_not_onboarded" };
  if (hasActiveHold) return { buyable: false, reason: "reserved" };

  return { buyable: true, amountCents: cents };
}

export const PURCHASE_REASON_TEXT: Record<PurchaseBlockReason, string> = {
  free: "This item is free. Message the seller to arrange pickup.",
  below_minimum: "Online payment is available for items priced $0.50 or more.",
  above_maximum: "This price is above the online payment limit.",
  sold: "This item has been sold.",
  reserved: "Someone is checking out this item right now. Try again in a few minutes.",
  seller_not_onboarded: "The seller hasn't set up payments yet. Message them to arrange the sale.",
  payments_unavailable: "Online payments are temporarily unavailable.",
};
