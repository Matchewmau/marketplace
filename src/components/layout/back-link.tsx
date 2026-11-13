import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function BackLink({
  href = "/",
  children = "Back to Marketplace",
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {children}
    </Link>
  );
}
