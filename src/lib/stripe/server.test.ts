import { describe, expect, it } from "vitest";
import { getAppOrigin, getCheckoutReturnOrigin } from "@/lib/stripe/server";

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

describe("getCheckoutReturnOrigin", () => {
  function req(url: string, origin?: string) {
    const headers = new Headers();
    if (origin !== undefined) headers.set("origin", origin);
    return new Request(url, { method: "POST", headers });
  }
  const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

  it("uses the Origin header when it equals the request origin", () => {
    expect(
      getCheckoutReturnOrigin(
        req("https://shop-git-preview.vercel.app/api/checkout", "https://shop-git-preview.vercel.app"),
        env({ APP_URL: "https://shop.example" }),
      ),
    ).toBe("https://shop-git-preview.vercel.app");
  });

  it("uses the Origin header when it equals the APP_URL origin behind a proxy", () => {
    expect(
      getCheckoutReturnOrigin(
        req("http://localhost:3000/api/checkout", "https://shop.example"),
        env({ APP_URL: "https://shop.example/path" }),
      ),
    ).toBe("https://shop.example");
  });

  it.each([
    ["VERCEL_PROJECT_PRODUCTION_URL", "shop.example.com"],
    ["VERCEL_URL", "shop-abc123.vercel.app"],
    ["VERCEL_BRANCH_URL", "shop-git-feature.vercel.app"],
  ])("uses the Origin header when it matches %s", (name, host) => {
    expect(
      getCheckoutReturnOrigin(
        req("http://localhost:3000/api/checkout", `https://${host}`),
        env({ APP_URL: "https://other.example", [name]: host }),
      ),
    ).toBe(`https://${host}`);
  });

  it("falls back to APP_URL for a foreign Origin", () => {
    expect(
      getCheckoutReturnOrigin(
        req("http://localhost:3000/api/checkout", "https://evil.test"),
        env({ APP_URL: "https://shop.example" }),
      ),
    ).toBe("https://shop.example");
  });

  it("falls back to the request origin for a foreign Origin without APP_URL", () => {
    expect(
      getCheckoutReturnOrigin(req("http://localhost:3000/api/checkout", "https://evil.test"), env({})),
    ).toBe("http://localhost:3000");
  });

  it("uses the request origin without an Origin header or APP_URL", () => {
    expect(getCheckoutReturnOrigin(req("http://localhost:3000/api/checkout?x=1"), env({}))).toBe(
      "http://localhost:3000",
    );
  });

  it("falls back to APP_URL without an Origin header", () => {
    expect(
      getCheckoutReturnOrigin(
        req("http://localhost:3000/api/checkout"),
        env({ APP_URL: "https://shop.example" }),
      ),
    ).toBe("https://shop.example");
  });

  it("treats Origin: null as absent", () => {
    expect(
      getCheckoutReturnOrigin(
        req("http://localhost:3000/api/checkout", "null"),
        env({ APP_URL: "https://shop.example" }),
      ),
    ).toBe("https://shop.example");
    expect(getCheckoutReturnOrigin(req("http://localhost:3000/api/checkout", "null"), env({}))).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores an invalid APP_URL and non-http Origin", () => {
    expect(
      getCheckoutReturnOrigin(
        req("http://localhost:3000/api/checkout", "ftp://localhost:3000"),
        env({ APP_URL: "not a url" }),
      ),
    ).toBe("http://localhost:3000");
  });

  it("keeps the scheme so http and https origins stay distinct", () => {
    expect(
      getCheckoutReturnOrigin(
        req("http://localhost:3000/api/checkout", "https://localhost:3000"),
        env({}),
      ),
    ).toBe("http://localhost:3000");
  });
});
