import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";
import type { Listing } from "@/lib/types";
import { isUuid } from "@/lib/validation";

type ListingRow = Omit<Listing, "price"> & { price: number | string };

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

    return NextResponse.json({ listing });
  } catch {
    return NextResponse.json(
      { error: "Failed to load listing" },
      { status: 500 },
    );
  }
}
