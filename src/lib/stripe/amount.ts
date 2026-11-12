export const STRIPE_MIN_CHARGE_CENTS = 50;
export const STRIPE_MAX_CHARGE_CENTS = 99_999_999;

const DOLLAR_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Dollars (number or decimal string, max 2 decimals) → integer cents using integer math only; null for invalid, negative, non-finite, or > Number.MAX_SAFE_INTEGER results. */
export function dollarsToCents(value: number | string): number | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    text = value.toFixed(2);
  } else {
    text = value.trim();
  }

  const match = DOLLAR_PATTERN.exec(text);
  if (!match) return null;

  const [, whole, frac] = match;
  const cents = Number(whole) * 100 + Number((frac ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function applicationFeeCents(amountCents: number, bps: number): number {
  return Math.floor((amountCents * bps) / 10000);
}

/** Stripe Checkout product images must be https URLs of at most 2048 chars. */
export function safeProductImage(url: string | null | undefined): string[] | undefined {
  if (!url || url.length > 2048) return undefined;
  try {
    return new URL(url).protocol === "https:" ? [url] : undefined;
  } catch {
    return undefined;
  }
}
