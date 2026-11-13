"use client";

import { useId, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONDITIONS } from "@/lib/conditions";
import type { FilterState, SortOption } from "@/lib/types";

type FilterChangeOptions = {
  debounce?: boolean;
};

type FilterBarProps = {
  filters: FilterState;
  onChange: (next: FilterState, options?: FilterChangeOptions) => void;
  onClear: () => void;
};

function update(
  filters: FilterState,
  key: keyof FilterState,
  value: string,
): FilterState {
  return { ...filters, [key]: value };
}

export function FilterBar({ filters, onChange, onClear }: FilterBarProps) {
  const hasActiveFilters =
    Boolean(
      filters.search ||
        filters.minPrice ||
        filters.maxPrice ||
        filters.condition ||
        filters.location,
    ) || filters.sort !== "newest";

  const activeCount =
    [
      filters.minPrice,
      filters.maxPrice,
      filters.condition,
      filters.location,
    ].filter(Boolean).length + (filters.sort !== "newest" ? 1 : 0);

  const fieldsId = useId();
  const [expanded, setExpanded] = useState(activeCount > 0);

  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/[0.03]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={fieldsId}
        onClick={() => setExpanded((open) => !open)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40 sm:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        Filters
        {activeCount > 0 && (
          <>
            <span
              aria-hidden="true"
              className="rounded-full bg-[#E7F3FF] px-2 py-0.5 text-xs font-semibold text-[#1877F2]"
            >
              {activeCount}
            </span>
            <span className="sr-only">, {activeCount} active</span>
          </>
        )}
        <ChevronDown
          aria-hidden="true"
          className={`ml-auto size-4 motion-safe:transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        id={fieldsId}
        className={`${
          expanded ? "mt-3 flex" : "hidden"
        } flex-col gap-3 sm:mt-0 sm:flex sm:flex-row sm:flex-wrap sm:items-end`}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 sm:w-28">
          Min price
          <Input
            type="number"
            min="0"
            step="0.01"
            value={filters.minPrice}
            onChange={(event) =>
              onChange(update(filters, "minPrice", event.target.value), {
                debounce: true,
              })
            }
            placeholder="0"
            className="bg-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 sm:w-28">
          Max price
          <Input
            type="number"
            min="0"
            step="0.01"
            value={filters.maxPrice}
            onChange={(event) =>
              onChange(update(filters, "maxPrice", event.target.value), {
                debounce: true,
              })
            }
            placeholder="Any"
            className="bg-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 sm:w-44">
          Condition
          <Select
            value={filters.condition || "all"}
            onValueChange={(value) =>
              onChange(update(filters, "condition", value === "all" ? "" : value))
            }
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="All conditions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All conditions</SelectItem>
              {CONDITIONS.map((condition) => (
                <SelectItem key={condition} value={condition}>
                  {condition}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 sm:w-44">
          Location
          <Input
            type="text"
            value={filters.location}
            onChange={(event) =>
              onChange(update(filters, "location", event.target.value), {
                debounce: true,
              })
            }
            placeholder="City or area"
            className="bg-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 sm:w-48">
          Sort
          <Select
            value={filters.sort}
            onValueChange={(value) =>
              onChange(update(filters, "sort", value as SortOption))
            }
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Newest" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="price_asc">Price: Low to High</SelectItem>
              <SelectItem value="price_desc">Price: High to Low</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <Button
          type="button"
          variant="ghost"
          onClick={onClear}
          disabled={!hasActiveFilters}
          className="text-gray-600 sm:mb-0"
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}
