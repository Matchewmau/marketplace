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

type FilterBarProps = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
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
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 sm:w-28">
          Min price
          <Input
            type="number"
            min="0"
            step="0.01"
            value={filters.minPrice}
            onChange={(event) =>
              onChange(update(filters, "minPrice", event.target.value))
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
              onChange(update(filters, "maxPrice", event.target.value))
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
              onChange(update(filters, "location", event.target.value))
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
          className="text-gray-600 sm:mb-0"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
