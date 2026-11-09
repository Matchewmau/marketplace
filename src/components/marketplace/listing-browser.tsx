"use client";

import { useEffect, useState } from "react";

import { FilterBar } from "@/components/marketplace/filter-bar";
import { ItemGrid } from "@/components/marketplace/item-grid";
import { SearchBar } from "@/components/marketplace/search-bar";
import type { FilterState, Listing } from "@/lib/types";

type ListingBrowserProps = {
  category?: string;
  sellerEmail?: string;
  showFilters?: boolean;
  heading?: string;
  emptyMessage?: string;
};

const EMPTY_FILTERS: FilterState = {
  search: "",
  minPrice: "",
  maxPrice: "",
  condition: "",
  location: "",
  sort: "newest",
};

export function ListingBrowser({
  category,
  sellerEmail,
  showFilters = true,
  heading = "Today’s picks",
  emptyMessage,
}: ListingBrowserProps) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchVersion, setFetchVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();

        if (filters.search) params.set("search", filters.search);
        if (filters.minPrice) params.set("minPrice", filters.minPrice);
        if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
        if (filters.condition) params.set("condition", filters.condition);
        if (filters.location) params.set("location", filters.location);
        if (filters.sort) params.set("sort", filters.sort);
        if (category) params.set("category", category);
        if (sellerEmail) params.set("sellerEmail", sellerEmail);

        const response = await fetch(`/api/listings?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as {
          listings?: Listing[];
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(data?.error ?? "Failed to load listings");
        }

        setListings(data?.listings ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Failed to load listings",
        );
        setListings([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, category, sellerEmail, fetchVersion]);

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setSearchInput("");
  }

  function reload() {
    setFetchVersion((value) => value + 1);
  }

  return (
    <div className="min-w-0 space-y-4">
      <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
        {heading}
      </h1>

      <SearchBar
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={() =>
          setFilters((current) => ({
            ...current,
            search: searchInput.trim(),
          }))
        }
      />

      {showFilters ? (
        <FilterBar filters={filters} onChange={setFilters} onClear={clearFilters} />
      ) : null}

      <ItemGrid
        listings={listings}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        onRetry={reload}
      />
    </div>
  );
}
