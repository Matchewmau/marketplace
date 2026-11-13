export type Listing = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  category: string;
  condition: string;
  seller_email: string;
  image_url: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
  status: "active" | "sold";
  sold_at: string | null;
};

export type Message = {
  id: string;
  listing_id: string;
  buyer_email: string;
  seller_email: string;
  message: string;
  created_at: string;
};

export type InboxMessage = Message & {
  listing_title: string;
  listing_image_url: string | null;
  listing_price: number;
};

export type SortOption = "newest" | "price_asc" | "price_desc";

export type FilterState = {
  search: string;
  minPrice: string;
  maxPrice: string;
  condition: string;
  location: string;
  sort: SortOption;
};

export type SellerPaymentStatus = { stripe_account_id: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean; connected_at?: string | null };
export type PublicSellerStatus = { charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean; account_hint: string; connected_at: string | null; active_listings?: number };
export type PurchaseBlockReason = "free" | "below_minimum" | "above_maximum" | "sold" | "reserved" | "seller_not_onboarded" | "payments_unavailable";
export type PurchaseState = { buyable: true; amountCents: number } | { buyable: false; reason: PurchaseBlockReason };
