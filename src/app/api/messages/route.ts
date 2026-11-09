import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";
import type { Message } from "@/lib/types";
import { validateMessageInput } from "@/lib/validation";

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
