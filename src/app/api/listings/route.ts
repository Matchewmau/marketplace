import { NextResponse } from "next/server";

import { isCategoryName } from "@/lib/categories";
import { isCondition } from "@/lib/conditions";
import { supabase } from "@/lib/supabase";
import type { Listing, SortOption } from "@/lib/types";
import { sanitizeFilterTerm, validateListingInput } from "@/lib/validation";

const SORT_OPTIONS: SortOption[] = ["newest", "price_asc", "price_desc"];

type ListingRow = Omit<Listing, "price"> & { price: number | string };

type PriceResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

function parsePrice(value: string | null, name: string): PriceResult {
  if (value === null || value.trim() === "") {
    return { ok: true, value: null };
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      ok: false,
      error: `${name} must be a non-negative number.`,
    };
  }

  return { ok: true, value: amount };
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid listing data." },
      { status: 400 },
    );
  }

  const result = validateListingInput(body);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("listings")
      .insert(result.value)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Failed to create listing" },
        { status: 500 },
      );
    }

    const row = data as ListingRow;
    const listing = { ...row, price: Number(row.price) } as Listing;

    return NextResponse.json({ listing }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create listing" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const minPrice = parsePrice(params.get("minPrice"), "minPrice");
  if (!minPrice.ok) {
    return NextResponse.json({ error: minPrice.error }, { status: 400 });
  }

  const maxPrice = parsePrice(params.get("maxPrice"), "maxPrice");
  if (!maxPrice.ok) {
    return NextResponse.json({ error: maxPrice.error }, { status: 400 });
  }

  if (
    minPrice.value !== null &&
    maxPrice.value !== null &&
    minPrice.value > maxPrice.value
  ) {
    return NextResponse.json(
      { error: "minPrice must be less than or equal to maxPrice." },
      { status: 400 },
    );
  }

  const sort = (params.get("sort") ?? "newest") as SortOption;
  if (!SORT_OPTIONS.includes(sort)) {
    return NextResponse.json(
      { error: "sort must be newest, price_asc, or price_desc." },
      { status: 400 },
    );
  }

  const condition = params.get("condition");
  if (condition && !isCondition(condition)) {
    return NextResponse.json(
      { error: "condition is invalid." },
      { status: 400 },
    );
  }

  const category = params.get("category");
  if (category && !isCategoryName(category)) {
    return NextResponse.json(
      { error: "category is invalid." },
      { status: 400 },
    );
  }

  const sellerEmail = params.get("sellerEmail")?.trim().toLowerCase();
  const search = sanitizeFilterTerm(params.get("search") ?? "");
  const location = sanitizeFilterTerm(params.get("location") ?? "");

  try {
    let query = supabase.from("listings").select("*");

    if (search) {
      query = query.or(
        `title.ilike.%${search}%,description.ilike.%${search}%`,
      );
    }

    if (category) {
      query = query.eq("category", category);
    }

    if (condition) {
      query = query.eq("condition", condition);
    }

    if (location) {
      query = query.ilike("location", `%${location}%`);
    }

    if (minPrice.value !== null) {
      query = query.gte("price", minPrice.value);
    }

    if (maxPrice.value !== null) {
      query = query.lte("price", maxPrice.value);
    }

    if (sellerEmail) {
      query = query.eq("seller_email", sellerEmail);
    }

    if (sort === "price_asc") {
      query = query.order("price", { ascending: true });
    } else if (sort === "price_desc") {
      query = query.order("price", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query.limit(100);

    if (error) {
      return NextResponse.json(
        { error: "Failed to load listings" },
        { status: 500 },
      );
    }

    const listings = ((data ?? []) as ListingRow[]).map((row) => ({
      ...row,
      price: Number(row.price),
    }));

    return NextResponse.json({ listings });
  } catch {
    return NextResponse.json(
      { error: "Failed to load listings" },
      { status: 500 },
    );
  }
}
