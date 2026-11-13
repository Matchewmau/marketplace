import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  StripeConfigError,
  assertSandboxSecretKey,
  readPlatformFeeBps,
  readStripeEnv,
} from "@/lib/stripe/config";

describe("assertSandboxSecretKey", () => {
  it("rejects a live secret key", () => {
    expect(() => assertSandboxSecretKey("sk_live_abc")).toThrow(StripeConfigError);
  });

  it("rejects a publishable key", () => {
    expect(() => assertSandboxSecretKey("pk_test_abc")).toThrow(StripeConfigError);
  });

  it("accepts a sandbox secret key", () => {
    expect(assertSandboxSecretKey("sk_test_abc")).toBe("sk_test_abc");
  });

  it("accepts a sandbox restricted key", () => {
    expect(assertSandboxSecretKey("rk_test_abc")).toBe("rk_test_abc");
  });

  it("rejects a missing key", () => {
    expect(() => assertSandboxSecretKey(undefined)).toThrow(StripeConfigError);
  });

  it("trims surrounding whitespace and returns the trimmed key", () => {
    expect(assertSandboxSecretKey("sk_test_abc ")).toBe("sk_test_abc");
  });

  it("rejects a value with an embedded newline and a second key", () => {
    expect(() => assertSandboxSecretKey("sk_test_abc\nsk_live_xyz")).toThrow(
      StripeConfigError,
    );
  });

  it("rejects a key with trailing non-alphanumeric characters", () => {
    expect(() => assertSandboxSecretKey("sk_test_abc!")).toThrow(StripeConfigError);
  });

  it("does not include the key value in the error message", () => {
    let caught: unknown;
    try {
      assertSandboxSecretKey("sk_live_secretvalue");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StripeConfigError);
    expect((caught as Error).message).not.toContain("sk_live_secretvalue");
  });
});

describe("readStripeEnv", () => {
  it("rejects a non-numeric PLATFORM_FEE_BPS", () => {
    expect(() =>
      readStripeEnv({
        STRIPE_SECRET_KEY: "sk_test_abc",
        PLATFORM_FEE_BPS: "abc",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(StripeConfigError);
  });

  it("applies defaults when only the secret key is set", () => {
    const env = readStripeEnv({
      STRIPE_SECRET_KEY: "sk_test_abc",
    } as unknown as NodeJS.ProcessEnv);
    expect(env).toMatchObject({
      secretKey: "sk_test_abc",
      webhookSecret: null,
      platformFeeBps: 1000,
      appUrl: null,
    });
  });

  it("readPlatformFeeBps allows an explicit 0", () => {
    expect(
      readPlatformFeeBps({ PLATFORM_FEE_BPS: "0" } as unknown as NodeJS.ProcessEnv),
    ).toBe(0);
  });

  it("readPlatformFeeBps defaults to 1000 and needs no secret key", () => {
    const fee = readPlatformFeeBps({} as unknown as NodeJS.ProcessEnv);
    expect(fee).toBe(1000);
    expect(fee).toBe(DEFAULT_PLATFORM_FEE_BPS);
  });

  it("readPlatformFeeBps rejects invalid values", () => {
    for (const value of ["abc", "10001", "-5", "2.5"]) {
      expect(() =>
        readPlatformFeeBps({ PLATFORM_FEE_BPS: value } as unknown as NodeJS.ProcessEnv),
      ).toThrow(StripeConfigError);
    }
  });

  it("normalizes APP_URL to its origin without a trailing slash", () => {
    const env = readStripeEnv({
      STRIPE_SECRET_KEY: "sk_test_abc",
      APP_URL: "https://shop.example/",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.appUrl).toBe("https://shop.example");
  });

  it("rejects a PLATFORM_FEE_BPS above 10000", () => {
    expect(() =>
      readStripeEnv({
        STRIPE_SECRET_KEY: "sk_test_abc",
        PLATFORM_FEE_BPS: "10001",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(StripeConfigError);
  });

  it("rejects an APP_URL that is not http or https", () => {
    expect(() =>
      readStripeEnv({
        STRIPE_SECRET_KEY: "sk_test_abc",
        APP_URL: "ftp://x.test",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(StripeConfigError);
  });
});
