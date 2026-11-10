import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  function keyType(value: string): string {
    if (value.startsWith("sb_secret_")) return "secret";
    if (value.startsWith("sb_publishable_")) return "publishable";
    if (value.startsWith("eyJ")) return "legacy-jwt";
    return value ? "other" : "missing";
  }

  return NextResponse.json(
    {
      vercelEnv: process.env.VERCEL_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anon),
      anonKeyLength: anon.length,
      anonKeyType: keyType(anon),
      hasServiceKey: Boolean(service),
      serviceKeyLength: service.length,
      serviceKeyType: keyType(service),
      keysMatch: Boolean(service) && service === anon,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
