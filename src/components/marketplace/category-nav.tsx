"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const pathCategory = pathname.startsWith("/category/")
    ? pathname.split("/")[2]
    : undefined;
  const currentCategory = activeCategory ?? pathCategory;

  useEffect(() => {
    const nav = navRef.current;
    const activeLink = activeRef.current;

    if (!isStrip || !nav || !activeLink) {
      return;
    }

    const target =
      activeLink.offsetLeft -
      nav.clientWidth / 2 +
      activeLink.clientWidth / 2;

    nav.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [currentCategory, isStrip]);

  return (
    <nav
      ref={navRef}
      aria-label="Categories"
      className={cn(
        isStrip
          ? "flex gap-2 overflow-x-auto pb-1"
          : "flex flex-col gap-0.5",
      )}
    >
      {CATEGORIES.map((category) => {
        const active = currentCategory === category.slug;

        return (
          <Link
            key={category.slug}
            ref={active ? activeRef : undefined}
            href={`/category/${category.slug}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40",
              isStrip
                ? "whitespace-nowrap rounded-full border border-transparent bg-gray-100 px-3.5 py-1.5 text-gray-600 hover:bg-gray-200"
                : "rounded-lg px-2.5 py-2 text-gray-600 hover:bg-gray-100",
              active &&
                (isStrip
                  ? "border-[#B8D8FF] bg-[#E7F3FF] font-semibold text-[#1877F2] hover:bg-[#E7F3FF]"
                  : "bg-[#E7F3FF] font-semibold text-[#1877F2] hover:bg-[#E7F3FF]"),
            )}
          >
            {category.name}
          </Link>
        );
      })}
    </nav>
  );
}
