/** Basis points as a percent string: 1000→"10%", 250→"2.5%", 1→"0.01%", 10000→"100%". */
export function formatFeePercent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** null when bps is not a finite number above 0. */
export function platformFeeNotice(bps: number): string | null {
  if (!Number.isFinite(bps) || bps <= 0) return null;
  return `The marketplace keeps a ${formatFeePercent(bps)} platform fee on each sale; the rest goes to your Stripe account.`;
}
