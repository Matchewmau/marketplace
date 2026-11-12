import Link from "next/link";

import { ImageWithFallback } from "@/components/marketplace/image-with-fallback";
import { Badge } from "@/components/ui/badge";
import { formatLocation, formatPrice, formatRelativeTime } from "@/lib/format";
import type { Listing } from "@/lib/types";

type ItemCardProps = {
  listing: Listing;
};

export function ItemCard({ listing }: ItemCardProps) {
  return (
    <Link
      href={`/item/${listing.id}`}
      className="group block overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/[0.03] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40"
    >
      <div className="relative aspect-square overflow-hidden bg-gray-100">
        <ImageWithFallback
          src={listing.image_url}
          alt={listing.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
          className="object-cover transition-transform duration-300 group-hover:scale-[1.025]"
        />
        {listing.status === "sold" && (
          <Badge
            variant="secondary"
            className="absolute left-2 top-2 bg-gray-900/80 text-white hover:bg-gray-900/80"
          >
            Sold
          </Badge>
        )}
      </div>
      <div className="p-3.5">
        <p className="text-[17px] font-semibold leading-6 text-gray-800">
          {formatPrice(listing.price)}
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-sm leading-5 text-gray-700">
          {listing.title}
        </h3>
        <p className="mt-1.5 truncate text-xs text-gray-500">
          {formatRelativeTime(listing.created_at)} ·{" "}
          {formatLocation(listing.location)}
        </p>
      </div>
    </Link>
  );
}
