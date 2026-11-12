const APP_SCOPE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,99}$/i;

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "host.docker.internal",
]);

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
}

/**
 * Identifies this deployment's Checkout Sessions. An explicit APP_SCOPE wins; otherwise the
 * Supabase project host (e.g. `xyz.supabase.co`). Environments that share one Stripe sandbox but
 * use different scopes ignore each other's sessions instead of refunding them.
 * Null (checkout disabled, every session ignored) when APP_SCOPE is invalid, when
 * NEXT_PUBLIC_SUPABASE_URL is unset or invalid, or when it points at a local Supabase without
 * APP_SCOPE: default local hosts are identical for every developer, so they are not unique.
 */
export function getAppScope(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const override = env.APP_SCOPE?.trim() ?? "";
  if (override !== "") {
    return APP_SCOPE_PATTERN.test(override) ? override.toLowerCase() : null;
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
