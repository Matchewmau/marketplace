"use client";

import Link from "next/link";
import { MessageCircle, UserRound, Wallet } from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Icons are resolved here because component references cannot be passed as
// props from Server Components to Client Components.
const ICONS = {
  messages: MessageCircle,
  "get-paid": Wallet,
  "your-listings": UserRound,
} as const;

export function HeaderNavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}) {
  const Icon = ICONS[icon];
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 min-w-11 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40 lg:px-3",
        active
          ? "bg-[#E7F3FF] text-[#1877F2]"
          : "text-gray-600 hover:bg-gray-100",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="sr-only lg:not-sr-only">{label}</span>
    </Link>
  );
}
