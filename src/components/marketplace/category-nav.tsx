import Link from "next/link";

import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";

type CategoryNavProps = {
  activeCategory?: string;
  variant?: "sidebar" | "strip";
};

export function CategoryNav({
  activeCategory,
  variant = "sidebar",
}: CategoryNavProps) {
  const isStrip = variant === "strip";

  return (
    <nav
      aria-label="Categories"
      className={cn(
        isStrip
          ? "flex gap-2 overflow-x-auto pb-1"
          : "flex flex-col gap-0.5",
      )}
    >
      {CATEGORIES.map((category) => {
        const active = activeCategory === category.slug;

        return (
          <Link
            key={category.slug}
            href={`/category/${category.slug}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sm transition-colors",
              isStrip
                ? "whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                : "rounded-md px-2 py-1.5 text-gray-700 hover:bg-gray-100",
              active &&
                (isStrip
                  ? "border-blue-200 bg-blue-50 font-medium text-[#1877F2] hover:bg-blue-50"
                  : "bg-blue-50 font-medium text-[#1877F2] hover:bg-blue-50"),
            )}
          >
            {category.name}
          </Link>
        );
      })}
    </nav>
  );
}
