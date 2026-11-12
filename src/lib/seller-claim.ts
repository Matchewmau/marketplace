import { isValidEmail } from "@/lib/validation";

export type OnboardDecision =
  | { action: "create" }
  | { action: "link"; accountId: string }
  | { action: "status_only"; accountId: string };

/** First onboarding binds an email to one Stripe account; links are issued only until details are submitted. */
export function decideOnboarding(
  row: { stripe_account_id: string; details_submitted: boolean } | null,
): OnboardDecision {
  if (row === null) return { action: "create" };
  if (!row.details_submitted) return { action: "link", accountId: row.stripe_account_id };
  return { action: "status_only", accountId: row.stripe_account_id };
}

const MAX_EMAIL_LENGTH = 255;

export function normalizeSellerEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) return null;
  if (!isValidEmail(email)) return null;
  return email;
}
