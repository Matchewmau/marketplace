import { describe, expect, it } from "vitest";

import { getAppScope } from "@/lib/stripe/app-scope";

describe("getAppScope", () => {
  it("returns the lowercase Supabase project host", () => {
    expect(getAppScope({ NEXT_PUBLIC_SUPABASE_URL: "https://XYZ.supabase.co/" })).toBe(
      "xyz.supabase.co",
    );
  });

  it("keeps the port so local Supabase instances are distinct", () => {
    expect(getAppScope({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(
      "127.0.0.1:54321",
    );
  });

  it.each([
    ["unset", undefined],
    ["empty", "  "],
    ["not a url", "xyz.supabase.co"],
    ["not http", "ftp://xyz.supabase.co"],
  ])("returns null when the url is %s", (_label, url) => {
    expect(getAppScope({ NEXT_PUBLIC_SUPABASE_URL: url })).toBeNull();
  });
});
