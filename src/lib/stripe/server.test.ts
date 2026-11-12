import { describe, expect, it } from "vitest";
import { getAppOrigin } from "@/lib/stripe/server";

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
