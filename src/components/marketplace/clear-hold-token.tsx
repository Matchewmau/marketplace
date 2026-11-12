"use client";

import { useEffect } from "react";

/** Forgets the buyer's saved checkout hold for a listing once checkout has finished or been cancelled. */
export function ClearHoldToken({ listingId }: { listingId: string }) {
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(`hold:${listingId}`);
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }, [listingId]);

  return null;
}
