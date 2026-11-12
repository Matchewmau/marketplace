/**
 * Identifies this deployment's Checkout Sessions: the Supabase project host (e.g. `xyz.supabase.co`).
 * Environments that share one Stripe sandbox but use different Supabase projects ignore each
 * other's sessions instead of refunding them. Null when NEXT_PUBLIC_SUPABASE_URL is unset or invalid.
 */
export function getAppScope(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (raw === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.host.toLowerCase() || null;
}
