import Link from "next/link";
import { Bell, UserRound, Wallet } from "lucide-react";

import { FacebookLogo } from "@/components/layout/facebook-logo";
import { HeaderMessagesLink } from "@/components/layout/header-messages-link";

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

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <HeaderMessagesLink />
          <span
            title="Notifications"
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 sm:h-10 sm:w-10"
          >
            <Bell className="h-5 w-5" />
          </span>
          <Link
            href="/seller/payments"
            aria-label="Get paid"
            title="Get paid"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 sm:h-10 sm:w-10"
          >
            <Wallet className="h-5 w-5" />
          </Link>
          <Link
            href="/your-listings"
            aria-label="Your listings"
            title="Your listings"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 sm:h-10 sm:w-10"
          >
            <UserRound className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
