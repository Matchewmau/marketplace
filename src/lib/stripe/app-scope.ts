const APP_SCOPE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,99}$/i;

/** Prefix for an explicit APP_SCOPE, so it can never equal a scope derived from a Supabase host. */
const EXPLICIT_SCOPE_PREFIX = "env:";

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "0.0.0.0",
  "host.docker.internal",
]);

const LOOPBACK_IPV4_PATTERN = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
// IPv4-mapped loopback (::ffff:127.x.y.z) as serialized by the WHATWG URL parser.
const MAPPED_LOOPBACK_PATTERN = /^\[::ffff:(7f[0-9a-f]{2}:[0-9a-f]{1,4}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\]$/;

/** Thrown when this deployment has no app scope, so paid sessions must be retried, not dropped. */
export class AppScopeUnavailableError extends Error {
  constructor(message = "App scope is unavailable: set a valid APP_SCOPE or NEXT_PUBLIC_SUPABASE_URL.") {
    super(message);
    this.name = "AppScopeUnavailableError";
  }
}

function isLocalHostname(hostname: string): boolean {
  const base = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  return (
    LOCAL_HOSTNAMES.has(base) ||
    base.endsWith(".localhost") ||
    LOOPBACK_IPV4_PATTERN.test(base) ||
    MAPPED_LOOPBACK_PATTERN.test(base)
  );
}

/**
 * Identifies this deployment's Checkout Sessions. An explicit APP_SCOPE wins (stored as
 * `env:<value>`); otherwise the Supabase project host (e.g. `xyz.supabase.co`). Environments that
 * share one Stripe sandbox but use different scopes ignore each other's sessions instead of
 * refunding them.
 * Null (checkout disabled, fulfilment and webhooks retried) when APP_SCOPE is invalid, when
 * NEXT_PUBLIC_SUPABASE_URL is unset or invalid, or when it points at a local Supabase without
 * APP_SCOPE: default local hosts are identical for every developer, so they are not unique.
 */
export function getAppScope(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const override = env.APP_SCOPE?.trim() ?? "";
  if (override !== "") {
    return APP_SCOPE_PATTERN.test(override)
      ? `${EXPLICIT_SCOPE_PREFIX}${override.toLowerCase()}`
      : null;
  }

  const raw = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (raw === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (isLocalHostname(parsed.hostname.toLowerCase())) return null;
  return parsed.host.toLowerCase() || null;
}
