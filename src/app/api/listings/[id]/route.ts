import { NextResponse } from "next/server";

import { getPurchaseState } from "@/lib/purchase";
import { readStripeEnv } from "@/lib/stripe/config";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { Listing, PurchaseState } from "@/lib/types";
import { isUuid } from "@/lib/validation";

type ListingRow = Omit<Listing, "price"> & { price: number | string };

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UNAVAILABLE = {
  seller: null,
  hasActiveHold: false,
  paymentsConfigured: false,
};

function stripeConfigured(): boolean {
  try {
    readStripeEnv();
    return true;
  } catch {
    return false;
  }
}

async function loadPurchaseGate(listing: Listing, holdToken: string | null) {
  const admin = getSupabaseAdmin();
  if (!admin || !stripeConfigured()) {
    return UNAVAILABLE;
  }

  const [sellerResult, holdResult] = await Promise.all([
    admin
      .from("seller_accounts")
      .select("charges_enabled")
      .eq("seller_email", listing.seller_email.trim().toLowerCase())
      .maybeSingle(),
    admin
      .from("listing_holds")
      .select("hold_token")
      .eq("listing_id", listing.id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  ]);

  const failure = sellerResult.error ?? holdResult.error;
  if (failure) {
    console.error("Purchase state lookup failed:", failure.message);
    return UNAVAILABLE;
  }

  return {
    seller: sellerResult.data
      ? { charges_enabled: Boolean(sellerResult.data.charges_enabled) }
      : null,
    hasActiveHold: Boolean(holdResult.data) &&
      !(holdToken !== null && holdResult.data?.hold_token === holdToken),
    paymentsConfigured: true,
  };
}

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  // The hold token is a bearer credential, so it travels in a header, never the query string.
  const rawHoldToken = request.headers.get("x-hold-token");
  const holdToken =
    rawHoldToken !== null && isUuid(rawHoldToken)
      ? rawHoldToken.toLowerCase()
      : null;

  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Listing not found" },
      { status: 404 },
    );
  }

  try {
    const { data, error } = await supabase
      .from("listings")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "Failed to load listing" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Listing not found" },
        { status: 404 },
      );
    }

    const listing = {
      ...(data as ListingRow),
      price: Number((data as ListingRow).price),
    } as Listing;

    let purchase: PurchaseState;
    try {
      const gate = await loadPurchaseGate(listing, holdToken);
      purchase = getPurchaseState(
        listing,
        gate.seller,
        gate.hasActiveHold,
        gate.paymentsConfigured,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Purchase state failed:", message);
      purchase = { buyable: false, reason: "payments_unavailable" };
    }

    return NextResponse.json({ listing, purchase });
  } catch {
    return NextResponse.json(
      { error: "Failed to load listing" },
      { status: 500 },
    );
  }
}
