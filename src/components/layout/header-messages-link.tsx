"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function HeaderMessagesLink() {
  const pathname = usePathname();
  const active = pathname === "/messages" || pathname.startsWith("/messages/");

  return (
    <Link
      href="/messages"
      aria-label="Messages"
      aria-current={active ? "page" : undefined}
      title="Messages"
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40 sm:h-10 sm:w-10",
        active
          ? "bg-[#E7F3FF] text-[#1877F2]"
          : "text-gray-600 hover:bg-gray-100",
      )}
    >
      <MessageCircle className="h-5 w-5" />
    </Link>
  );
}
