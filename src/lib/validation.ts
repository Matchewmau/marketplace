import { isCategoryName } from "@/lib/categories";
import { DEFAULT_CONDITION, isCondition } from "@/lib/conditions";

export type ListingInput = {
  title: string;
  description: string;
  price: number;
  category: string;
  condition: string;
  seller_email: string;
  image_url: string;
  location: string;
};

export type MessageInput = {
  listing_id: string;
  buyer_email: string;
  message: string;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UnknownRecord = Record<string, unknown>;

function asRecord(input: unknown): UnknownRecord | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  return input as UnknownRecord;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function sanitizeFilterTerm(value: string): string {
  return value
    .trim()
    .replace(/[,()%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateListingInput(
  input: unknown,
): { ok: true; value: ListingInput } | { ok: false; error: string } {
  const record = asRecord(input);

  if (!record) {
    return { ok: false, error: "Invalid listing data." };
  }

  const title = asString(record.title).trim();
  if (title.length < 3 || title.length > 255) {
    return { ok: false, error: "Title must be between 3 and 255 characters." };
  }

  const description = asString(record.description).trim();
  if (description.length === 0) {
    return { ok: false, error: "Description is required." };
  }

  const price = record.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return { ok: false, error: "Price must be a non-negative number." };
  }

  const category = asString(record.category);
  if (!isCategoryName(category)) {
    return { ok: false, error: "Category is invalid." };
  }

  const rawCondition = asString(record.condition).trim();
  const condition = rawCondition === "" ? DEFAULT_CONDITION : rawCondition;
  if (!isCondition(condition)) {
    return { ok: false, error: "Condition is invalid." };
  }

  const sellerEmail = asString(record.seller_email).trim().toLowerCase();
  if (!isValidEmail(sellerEmail)) {
    return { ok: false, error: "Seller email is invalid." };
  }

  const imageUrl = asString(record.image_url).trim();
  if (imageUrl.length === 0) {
    return { ok: false, error: "Image URL is required." };
  }

  const location = asString(record.location).trim() || "Palo Alto, CA";
  if (location.length > 255) {
    return { ok: false, error: "Location must be 255 characters or fewer." };
  }

  return {
    ok: true,
    value: {
      title,
      description,
      price,
      category,
      condition,
      seller_email: sellerEmail,
      image_url: imageUrl,
      location,
    },
  };
}

export function validateMessageInput(
  input: unknown,
): { ok: true; value: MessageInput } | { ok: false; error: string } {
  const record = asRecord(input);

  if (!record) {
    return { ok: false, error: "Invalid message data." };
  }

  const listingId = asString(record.listing_id).trim();
  if (!isUuid(listingId)) {
    return { ok: false, error: "Listing ID is invalid." };
  }

  const buyerEmail = asString(record.buyer_email).trim().toLowerCase();
  if (!isValidEmail(buyerEmail)) {
    return { ok: false, error: "Buyer email is invalid." };
  }

  const message = asString(record.message).trim();
  if (message.length < 1 || message.length > 2000) {
    return { ok: false, error: "Message must be between 1 and 2000 characters." };
  }

  return {
    ok: true,
    value: {
      listing_id: listingId,
      buyer_email: buyerEmail,
      message,
    },
  };
}
