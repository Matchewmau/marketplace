"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FilterBar } from "@/components/marketplace/filter-bar";
import { ItemGrid } from "@/components/marketplace/item-grid";
import { SearchBar } from "@/components/marketplace/search-bar";
import type { FilterState, Listing } from "@/lib/types";

const FILTER_DEBOUNCE_MS = 350;

type FilterChangeOptions = {
  debounce?: boolean;
};

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
  const [appliedFilters, setAppliedFilters] =
    useState<FilterState>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchVersion, setFetchVersion] = useState(0);
  const hasLoadedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const isInitialLoad = !hasLoadedRef.current;

    if (isInitialLoad) {
      setLoading(true);
    } else {
      setUpdating(true);
    }
    setError(null);

    async function load() {
      try {
        const params = new URLSearchParams();

        if (appliedFilters.search) {
          params.set("search", appliedFilters.search);
        }
        if (appliedFilters.minPrice) {
          params.set("minPrice", appliedFilters.minPrice);
        }
        if (appliedFilters.maxPrice) {
          params.set("maxPrice", appliedFilters.maxPrice);
        }
        if (appliedFilters.condition) {
          params.set("condition", appliedFilters.condition);
        }
        if (appliedFilters.location) {
          params.set("location", appliedFilters.location);
        }
        if (appliedFilters.sort) {
          params.set("sort", appliedFilters.sort);
        }
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
        hasLoadedRef.current = true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Failed to load listings",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setUpdating(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [appliedFilters, category, sellerEmail, fetchVersion]);

  function scheduleFilters(
    next: FilterState,
    options: FilterChangeOptions = {},
  ) {
    setFilters(next);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (options.debounce) {
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        setAppliedFilters(next);
      }, FILTER_DEBOUNCE_MS);
      return;
    }

    setAppliedFilters(next);
  }

  function clearFilters() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setSearchInput("");
  }

  function reload() {
    setFetchVersion((value) => value + 1);
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-800 sm:text-2xl">
          {heading}
        </h1>
        {updating ? (
          <p
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-xs text-gray-500"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating results…
          </p>
        ) : !loading && !error ? (
          <p className="text-xs text-gray-500" aria-live="polite">
            {listings.length} {listings.length === 1 ? "listing" : "listings"}
          </p>
        ) : null}
      </div>

      <SearchBar
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={() =>
          scheduleFilters({
            ...filters,
            search: searchInput.trim(),
          })
        }
      />

      {showFilters ? (
        <FilterBar
          filters={filters}
          onChange={scheduleFilters}
          onClear={clearFilters}
        />
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
