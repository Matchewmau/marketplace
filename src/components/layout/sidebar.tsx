import Link from "next/link";

import { CategoryNav } from "@/components/marketplace/category-nav";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const marketplaceLinks = [
  { href: "/create", label: "Choose listing type" },
  { href: "/your-listings", label: "Your listings" },
  { href: "/seller-help", label: "Seller help" },
];

type SidebarProps = {
  activeCategory?: string;
};

export function Sidebar({ activeCategory }: SidebarProps) {
  return (
    <aside className="min-w-0 lg:sticky lg:top-20">
      <div className="hidden rounded-lg bg-white p-4 shadow-sm lg:block">
        <h2 className="mb-3 px-2 text-lg font-semibold text-gray-900">
          Create new listing
        </h2>
        <nav aria-label="Marketplace links" className="flex flex-col gap-0.5">
          {marketplaceLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <Separator className="my-3" />
        <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
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
