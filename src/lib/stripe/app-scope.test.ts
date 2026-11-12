import { describe, expect, it } from "vitest";

import { getAppScope } from "@/lib/stripe/app-scope";

describe("getAppScope", () => {
  it("returns the lowercase Supabase project host", () => {
    expect(getAppScope({ NEXT_PUBLIC_SUPABASE_URL: "https://XYZ.supabase.co/" })).toBe(
      "xyz.supabase.co",
    );
  });

  it("returns a hosted Supabase host unchanged", () => {
    expect(getAppScope({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toBe(
      "abc.supabase.co",
    );
  });

  it("prefers APP_SCOPE, trimmed and lowercased", () => {
    expect(
      getAppScope({
        APP_SCOPE: "  Dev-Alice.Laptop:1  ",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      }),
    ).toBe("dev-alice.laptop:1");
  });

  it("uses APP_SCOPE with a local Supabase", () => {
    expect(
      getAppScope({ APP_SCOPE: "alice", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
    ).toBe("alice");
  });

  it.each([
    ["starts with a symbol", "-alice"],
    ["contains a space", "alice bob"],
    ["contains a slash", "alice/bob"],
    ["is too long", "a".repeat(101)],
  ])("returns null when APP_SCOPE %s", (_label, scope) => {
    expect(
      getAppScope({ APP_SCOPE: scope, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }),
    ).toBeNull();
  });

  it("ignores a blank APP_SCOPE", () => {
    expect(
      getAppScope({ APP_SCOPE: "   ", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }),
    ).toBe("abc.supabase.co");
  });

  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://LOCALHOST:54321",
    "http://[::1]:54321",
    "http://0.0.0.0:54321",
    "http://host.docker.internal:54321",
    "http://supabase.localhost:54321",
  ])("returns null for local Supabase %s without APP_SCOPE", (url) => {
    expect(getAppScope({ NEXT_PUBLIC_SUPABASE_URL: url })).toBeNull();
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
