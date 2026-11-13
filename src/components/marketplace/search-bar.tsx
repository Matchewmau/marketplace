import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function SearchBar({ value, onChange, onSubmit }: SearchBarProps) {
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search Marketplace"
          aria-label="Search Marketplace"
          className="h-10 bg-white pl-9"
        />
      </div>
      <Button
        type="submit"
        className="h-10 bg-brand-strong px-5 text-white hover:bg-brand-hover"
      >
        Search
      </Button>
    </form>
  );
}
