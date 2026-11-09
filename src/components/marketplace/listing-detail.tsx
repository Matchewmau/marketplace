"use client";

import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { useEffect, useState } from "react";

import { ImageWithFallback } from "@/components/marketplace/image-with-fallback";
import { MessageSellerForm } from "@/components/marketplace/message-seller-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatLocation, formatPrice, formatRelativeTime } from "@/lib/format";
import type { Listing } from "@/lib/types";

type ListingDetailProps = {
  listingId: string;
};

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "success"; listing: Listing };

export function ListingDetail({ listingId }: ListingDetailProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [fetchVersion, setFetchVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setState({ status: "loading" });

    async function load() {
      try {
        const response = await fetch(`/api/listings/${listingId}`, {
          signal: controller.signal,
        });

        if (response.status === 404) {
          setState({ status: "not-found" });
          return;
        }

        const data = (await response.json().catch(() => null)) as {
          listing?: Listing;
          error?: string;
        } | null;

        if (!response.ok || !data?.listing) {
          throw new Error(data?.error ?? "Failed to load listing");
        }

        setState({ status: "success", listing: data.listing });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load listing",
        });
      }
    }

    load();

    return () => controller.abort();
  }, [listingId, fetchVersion]);

  if (state.status === "loading") {
    return (
      <div className="grid gap-6 rounded-lg bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:p-6">
        <div className="aspect-[4/3] animate-pulse rounded-lg bg-gray-200" />
        <div className="space-y-4">
          <div className="h-8 w-3/4 animate-pulse rounded bg-gray-200" />
          <div className="h-9 w-1/3 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
          <div className="h-24 w-full animate-pulse rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-lg bg-white p-10 text-center shadow-sm">
        <p className="text-sm text-red-600">{state.message}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => setFetchVersion((value) => value + 1)}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="rounded-lg bg-white p-10 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Listing not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          This listing may have been removed or the link is incorrect.
        </p>
        <Button
          asChild
          className="mt-6 bg-[#1877F2] text-white hover:bg-[#166FE5]"
        >
          <Link href="/">Back to Marketplace</Link>
        </Button>
      </div>
    );
  }

  const { listing } = state;

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Marketplace
      </Link>

      <div className="grid gap-6 rounded-lg bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:p-6">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-gray-100">
          <ImageWithFallback
            src={listing.image_url}
            alt={listing.title}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 60vw"
            className="object-cover"
          />
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {listing.title}
            </h1>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {formatPrice(listing.price)}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Listed {formatRelativeTime(listing.created_at)} in{" "}
              {formatLocation(listing.location)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{listing.category}</Badge>
            <Badge variant="outline">{listing.condition}</Badge>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-900">Description</h2>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-gray-700">
              {listing.description ?? "No description provided."}
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h2 className="text-sm font-semibold text-gray-900">
              Seller information
            </h2>
            <a
              href={`mailto:${listing.seller_email}`}
              className="mt-2 inline-flex items-center gap-2 break-all text-sm font-medium text-[#1877F2] hover:underline"
            >
              <Mail className="h-4 w-4 shrink-0" />
              {listing.seller_email}
            </a>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">
              Message Seller
            </h2>
            <div className="rounded-md border border-dashed border-gray-300 p-4">
              <MessageSellerForm listingId={listing.id} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
