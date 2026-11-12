"use client";

import { CreditCard } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PURCHASE_REASON_TEXT } from "@/lib/purchase";
import { isTrustedStripeUrl } from "@/lib/stripe/redirect";
import type { PurchaseState } from "@/lib/types";

type BuyNowButtonProps = {
  listingId: string;
  purchase: PurchaseState;
};

const FALLBACK_ERROR = "Could not start checkout. Try again.";

export function BuyNowButton({ listingId, purchase }: BuyNowButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const reasonId = useId();

  if (!purchase.buyable && purchase.reason === "free") {
    return null;
  }

  if (!purchase.buyable) {
    return (
      <div>
        <Button
          type="button"
          disabled
          aria-describedby={reasonId}
          className="w-full"
        >
          Buy now
        </Button>
        <p id={reasonId} className="mt-2 text-sm text-gray-500">
          {PURCHASE_REASON_TEXT[purchase.reason]}
        </p>
      </div>
    );
  }

  async function handleClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);

    const key = `hold:${listingId}`;
    let holdToken: string | null = null;
    try {
      holdToken = window.sessionStorage.getItem(key);
    } catch {
      holdToken = null;
    }

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, holdToken: holdToken ?? undefined }),
      });
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        holdToken?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          // Storage unavailable; nothing to clear.
        }
        setError(data?.error ?? FALLBACK_ERROR);
        inFlight.current = false;
        setPending(false);
        return;
      }

      const url = data?.url;
      if (!isTrustedStripeUrl(url)) {
        setError(data?.error ?? FALLBACK_ERROR);
        inFlight.current = false;
        setPending(false);
        return;
      }

      if (data?.holdToken) {
        try {
          window.sessionStorage.setItem(key, data.holdToken);
        } catch {
          // Storage unavailable; checkout still works without a saved hold.
        }
      }
      window.location.assign(url);
    } catch {
      setError(FALLBACK_ERROR);
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="w-full bg-[#1877F2] text-white hover:bg-[#166FE5]"
      >
        <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
        {pending ? "Redirecting to checkout…" : "Buy now"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
