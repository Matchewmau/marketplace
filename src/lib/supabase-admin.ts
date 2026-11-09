import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseAdmin(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase admin client is server-only.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !url ||
    !key ||
    key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
