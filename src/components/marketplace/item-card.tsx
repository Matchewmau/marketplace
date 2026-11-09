import Link from "next/link";

import { ImageWithFallback } from "@/components/marketplace/image-with-fallback";
import { formatLocation, formatPrice, formatRelativeTime } from "@/lib/format";
import type { Listing } from "@/lib/types";

type ItemCardProps = {
  listing: Listing;
};

export function ItemCard({ listing }: ItemCardProps) {
  return (
    <Link
      href={`/item/${listing.id}`}
      className="group block overflow-hidden rounded-lg bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-square overflow-hidden bg-gray-100">
        <ImageWithFallback
          src={listing.image_url}
          alt={listing.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
          className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
      </div>
      <div className="p-3">
        <p className="text-lg font-bold text-gray-900">
          {formatPrice(listing.price)}
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-sm text-gray-800">
          {listing.title}
        </h3>
        <p className="mt-1 truncate text-xs text-gray-500">
          {formatRelativeTime(listing.created_at)} ·{" "}
          {formatLocation(listing.location)}
        </p>
      </div>
    </Link>
  );
}
