"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CancelResult } from "@/lib/checkout";

type CancelState = "pending" | CancelResult;

const RESULTS: ReadonlySet<string> = new Set(["cancelled", "already_paid", "refunded", "unknown"]);
// The checkout is settled either way, so the saved hold is no longer useful.
const DEFINITIVE: ReadonlySet<CancelState> = new Set(["cancelled", "already_paid", "refunded"]);

const COPY: Record<CancelState, { title: string; message: string }> = {
  pending: { title: "Closing checkout", message: "Closing your checkout…" },
  cancelled: { title: "Payment cancelled", message: "Payment cancelled. You were not charged." },
  already_paid: { title: "Payment received", message: "This payment already went through." },
  refunded: {
    title: "Item already sold",
    message: "This item was already sold. Your payment has been refunded.",
  },
  unknown: {
    title: "Checkout closed",
    message:
      "Your checkout was closed. If you were charged, you'll see an order confirmation or a refund.",
  },
};

function holdKey(listingId: string): string {
  return `hold:${listingId}`;
}

/** Cancels the buyer's checkout using the hold token saved in this tab, then reports the outcome. */
export function CancelCheckout({ listingId }: { listingId: string | null }) {
  const [state, setState] = useState<CancelState>("pending");
  // Guards against React StrictMode running the effect twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let holdToken: string | null = null;
    if (listingId) {
      try {
        holdToken = window.sessionStorage.getItem(holdKey(listingId));
      } catch {
        holdToken = null;
      }
    }
    if (!listingId || !holdToken) {
      setState("unknown");
      return;
    }

    async function cancel(id: string, token: string) {
      let result: CancelState = "unknown";
      try {
        const response = await fetch("/api/checkout/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: id, holdToken: token }),
        });
        const data = (await response.json().catch(() => null)) as { result?: unknown } | null;
        if (response.ok && typeof data?.result === "string" && RESULTS.has(data.result)) {
          result = data.result as CancelResult;
        }
      } catch {
        result = "unknown";
      }
      if (DEFINITIVE.has(result)) {
        try {
          window.sessionStorage.removeItem(holdKey(id));
        } catch {
          // Storage unavailable; nothing to clear.
        }
      }
      setState(result);
    }

    void cancel(listingId, holdToken);
  }, [listingId]);

  const copy = COPY[state];

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]">
        <h1 className="text-2xl font-semibold text-gray-800">{copy.title}</h1>
        <p role="status" className="mt-2 text-sm text-gray-600">
          {copy.message}
        </p>
        <Link
          href={listingId ? `/item/${listingId}` : "/"}
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-[#1877F2] px-4 text-sm font-medium text-white transition-colors hover:bg-[#166FE5]"
        >
          {listingId ? (state === "already_paid" ? "View item" : "Back to item") : "Back to Marketplace"}
        </Link>
      </div>
    </div>
  );
}
