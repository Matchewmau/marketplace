import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { InboxMessage, Message } from "@/lib/types";
import { isValidEmail, validateMessageInput } from "@/lib/validation";

type InboxListing = {
  title: string;
  image_url: string | null;
  price: number | string;
};

type InboxRow = Message & {
  listings: InboxListing | InboxListing[] | null;
};

function firstListing(row: InboxRow): InboxListing | null {
  if (Array.isArray(row.listings)) {
    return row.listings[0] ?? null;
  }

  return row.listings;
}

export async function GET(request: Request) {
  const sellerEmail = (
    new URL(request.url).searchParams.get("sellerEmail") ?? ""
  )
    .trim()
    .toLowerCase();

  if (!isValidEmail(sellerEmail)) {
    return NextResponse.json(
      { error: "Enter a valid seller email." },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Message inbox is not configured." },
      { status: 500 },
    );
  }

  try {
    const { data, error } = await admin
      .from("messages")
      .select(
        "id, listing_id, buyer_email, seller_email, message, created_at, listings!inner(title, image_url, price)",
      )
      .eq("seller_email", sellerEmail)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { error: "Failed to load messages." },
        { status: 500 },
      );
    }

    const messages = ((data ?? []) as InboxRow[]).map((row) => {
      const listing = firstListing(row);

      return {
        id: row.id,
        listing_id: row.listing_id,
        buyer_email: row.buyer_email,
        seller_email: row.seller_email,
        message: row.message,
        created_at: row.created_at,
        listing_title: listing?.title ?? "Listing unavailable",
        listing_image_url: listing?.image_url ?? null,
        listing_price: Number(listing?.price ?? 0),
      };
    }) satisfies InboxMessage[];

    return NextResponse.json(
      { messages },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to load messages." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid message data." },
      { status: 400 },
    );
  }

  const result = validateMessageInput(body);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  try {
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, seller_email")
      .eq("id", result.value.listing_id)
      .maybeSingle();

    if (listingError) {
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 },
      );
    }

    if (!listing) {
      return NextResponse.json(
        { error: "Listing not found" },
        { status: 404 },
      );
    }

    const message: Message = {
      id: randomUUID(),
      listing_id: result.value.listing_id,
      buyer_email: result.value.buyer_email,
      seller_email: listing.seller_email,
      message: result.value.message,
      created_at: new Date().toISOString(),
    };

    // Messages are insert-only by design (no public SELECT policy), so return
    // the synthesized row instead of asking PostgREST for a representation.
    const { error } = await supabase.from("messages").insert(message);

    if (error) {
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 },
      );
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}
