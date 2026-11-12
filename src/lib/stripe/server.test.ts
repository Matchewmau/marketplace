import { describe, expect, it } from "vitest";
import { getAppOrigin, getRequestOrigin } from "@/lib/stripe/server";

describe("getAppOrigin", () => {
  it("falls back to the request origin when APP_URL is unset", () => {
    expect(
      getAppOrigin(new Request("http://localhost:3000/api/x"), {} as unknown as NodeJS.ProcessEnv),
    ).toBe("http://localhost:3000");
  });

  it("uses APP_URL origin when it is a valid URL", () => {
    expect(
      getAppOrigin(new Request("http://localhost:3000/api/x"), {
        APP_URL: "https://shop.example/",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("https://shop.example");
  });
});

describe("getRequestOrigin", () => {
  it("returns the request origin without path or query", () => {
    expect(getRequestOrigin(new Request("https://shop.vercel.app:8443/api/checkout?x=1"))).toBe(
      "https://shop.vercel.app:8443",
    );
  });

  it("keeps the scheme so http and https localhost stay distinct", () => {
    expect(getRequestOrigin(new Request("http://localhost:3000/api/checkout"))).toBe(
      "http://localhost:3000",
    );
  });
});
