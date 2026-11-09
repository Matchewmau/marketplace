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
