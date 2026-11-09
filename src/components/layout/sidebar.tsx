"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CategoryNav } from "@/components/marketplace/category-nav";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const marketplaceLinks = [
  { href: "/create", label: "Choose listing type" },
  { href: "/your-listings", label: "Your listings" },
  { href: "/seller-help", label: "Seller help" },
];

type SidebarProps = {
  activeCategory?: string;
};

function isActiveLink(pathname: string, href: string) {
  if (href === "/create") {
    return pathname === "/create" || pathname.startsWith("/create/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ activeCategory }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
      <div className="hidden rounded-lg bg-white p-4 shadow-sm lg:block">
        <h2 className="mb-3 px-2 text-lg font-semibold text-gray-800">
          Create new listing
        </h2>
        <nav aria-label="Marketplace links" className="flex flex-col gap-0.5">
          {marketplaceLinks.map((link) => {
            const active = isActiveLink(pathname, link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-2.5 py-2 text-sm text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40",
                  active
                    ? "bg-[#E7F3FF] font-semibold text-[#1877F2] hover:bg-[#E7F3FF]"
                    : "hover:bg-gray-100",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <Separator className="my-3" />
        <h3 className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          Categories
        </h3>
        <CategoryNav activeCategory={activeCategory} />
      </div>

      <div className="min-w-0 rounded-lg bg-white p-3 shadow-sm lg:hidden">
        <Button
          asChild
          className="w-full bg-[#1877F2] text-white hover:bg-[#166FE5]"
        >
          <Link href="/create">Create new listing</Link>
        </Button>
        <div className="mt-3">
          <CategoryNav activeCategory={activeCategory} variant="strip" />
        </div>
      </div>
    </aside>
  );
}
