import Link from "next/link";

import { ItemCard } from "@/components/marketplace/item-card";
import { Button } from "@/components/ui/button";
import type { Listing } from "@/lib/types";

export const ITEM_GRID_CLASS =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

type ItemGridProps = {
  listings: Listing[];
  loading: boolean;
  error: string | null;
  emptyMessage?: string;
  onRetry?: () => void;
};

export function ItemGrid({
  listings,
  loading,
  error,
  emptyMessage,
  onRetry,
}: ItemGridProps) {
  if (loading) {
    return (
      <div
        className={ITEM_GRID_CLASS}
        aria-label="Loading listings"
        aria-busy="true"
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/[0.03]"
          >
            <div className="aspect-square animate-pulse bg-gray-200" />
            <div className="space-y-2 p-3">
              <div className="h-5 w-20 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]"
      >
        <p className="text-sm text-red-600">{error}</p>
        {onRetry ? (
          <Button variant="outline" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div
        role="status"
        className="rounded-xl bg-white p-10 text-center shadow-sm ring-1 ring-black/[0.03]"
      >
        <p className="text-sm text-gray-600">
          {emptyMessage ?? "No listings yet"}
        </p>
        <Button
          asChild
          className="mt-4 bg-[#1877F2] text-white hover:bg-[#166FE5]"
        >
          <Link href="/create">Create the first listing</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={ITEM_GRID_CLASS}>
      {listings.map((listing) => (
        <ItemCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
