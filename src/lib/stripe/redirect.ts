const TRUSTED_STRIPE_HOSTS = new Set(["checkout.stripe.com", "connect.stripe.com"]);

/** True only for https Checkout or Connect URLs on the default port without credentials. */
export function isTrustedStripeUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.port !== "") return false;
  if (url.username !== "" || url.password !== "") return false;
  return TRUSTED_STRIPE_HOSTS.has(url.hostname.toLowerCase());
}
