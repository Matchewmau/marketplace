import Link from "next/link";

import { FacebookLogo } from "@/components/layout/facebook-logo";
import { HeaderNavLink } from "@/components/layout/header-nav-link";
import { TestingGuideButton } from "@/components/layout/testing-guide";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4">
        <Link
          href="/"
          aria-label="Marketplace home"
          className="flex min-w-0 items-center gap-2"
        >
          <FacebookLogo />
          <span className="truncate text-lg font-semibold text-gray-800 sm:text-xl">
            Marketplace
          </span>
        </Link>

        <nav aria-label="Main" className="flex shrink-0 items-center gap-0.5">
          <HeaderNavLink href="/messages" label="Messages" icon="messages" />
          <HeaderNavLink href="/seller/payments" label="Get paid" icon="get-paid" />
          <HeaderNavLink href="/your-listings" label="Your listings" icon="your-listings" />
          <TestingGuideButton />
        </nav>
      </div>
    </header>
  );
}
