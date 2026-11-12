import { NextResponse } from "next/server";

import { getPurchaseState } from "@/lib/purchase";
import { readStripeEnv } from "@/lib/stripe/config";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { Listing } from "@/lib/types";
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

async function loadPurchaseGate(listing: Listing) {
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
      .select("listing_id")
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
    hasActiveHold: Boolean(holdResult.data),
    paymentsConfigured: true,
  };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

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

    const gate = await loadPurchaseGate(listing);
    const purchase = getPurchaseState(
      listing,
      gate.seller,
      gate.hasActiveHold,
      gate.paymentsConfigured,
    );

    return NextResponse.json({ listing, purchase });
  } catch {
    return NextResponse.json(
      { error: "Failed to load listing" },
      { status: 500 },
    );
  }
}
