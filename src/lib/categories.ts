export const CATEGORIES = [
  { name: "Vehicles", slug: "vehicles" },
  { name: "Property Rentals", slug: "property-rentals" },
  { name: "Apparel", slug: "apparel" },
  { name: "Classifieds", slug: "classifieds" },
  { name: "Electronics", slug: "electronics" },
  { name: "Entertainment", slug: "entertainment" },
  { name: "Family", slug: "family" },
  { name: "Free Stuff", slug: "free-stuff" },
  { name: "Garden & Outdoor", slug: "garden-outdoor" },
  { name: "Hobbies", slug: "hobbies" },
  { name: "Home Goods", slug: "home-goods" },
  { name: "Home Improvement", slug: "home-improvement" },
  { name: "Home Sales", slug: "home-sales" },
  { name: "Musical Instruments", slug: "musical-instruments" },
  { name: "Office Supplies", slug: "office-supplies" },
  { name: "Pet Supplies", slug: "pet-supplies" },
  { name: "Sporting Goods", slug: "sporting-goods" },
  { name: "Toys & Games", slug: "toys-games" },
  { name: "Buy and sell groups", slug: "buy-and-sell-groups" },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryName = Category["name"];

export function getCategoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}

export function getCategoryByName(name: string): Category | undefined {
  return CATEGORIES.find((category) => category.name === name);
}

export function isCategoryName(value: string): value is CategoryName {
  return CATEGORIES.some((category) => category.name === value);
}
