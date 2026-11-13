export class StripeConfigError extends Error {}

const SANDBOX_SECRET_KEY = /^(sk|rk)_test_[A-Za-z0-9]+$/;

/** Returns the key if it is a Stripe sandbox secret or restricted key; otherwise throws StripeConfigError. */
export function assertSandboxSecretKey(key: string | undefined): string {
  const trimmed = key?.trim() ?? "";
  if (!SANDBOX_SECRET_KEY.test(trimmed)) {
    throw new StripeConfigError(
      "STRIPE_SECRET_KEY must be a Stripe sandbox secret or restricted key (sk_test_ or rk_test_).",
    );
  }
  return trimmed;
}

export type StripeEnv = {
  secretKey: string;
  webhookSecret: string | null;
  platformFeeBps: number;
  appUrl: string | null;
};

export const DEFAULT_PLATFORM_FEE_BPS = 1000;

/** PLATFORM_FEE_BPS as an integer 0..10000. DEFAULT_PLATFORM_FEE_BPS when unset or empty. Throws StripeConfigError otherwise. Needs no secret key. */
export function readPlatformFeeBps(env: NodeJS.ProcessEnv = process.env): number {
  const feeRaw = env.PLATFORM_FEE_BPS?.trim() ?? "";
  let platformFeeBps = DEFAULT_PLATFORM_FEE_BPS;
  if (feeRaw !== "") {
    if (!/^\d+$/.test(feeRaw)) {
      throw new StripeConfigError("PLATFORM_FEE_BPS must be an integer from 0 to 10000.");
    }
    platformFeeBps = Number(feeRaw);
    if (platformFeeBps > 10000) {
      throw new StripeConfigError("PLATFORM_FEE_BPS must be an integer from 0 to 10000.");
    }
  }
  return platformFeeBps;
}

export function readStripeEnv(env: NodeJS.ProcessEnv = process.env): StripeEnv {
  const secretKey = assertSandboxSecretKey(env.STRIPE_SECRET_KEY);
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  const platformFeeBps = readPlatformFeeBps(env);

  const appUrlRaw = env.APP_URL?.trim() ?? "";
  let appUrl: string | null = null;
  if (appUrlRaw !== "") {
    let parsed: URL;
    try {
      parsed = new URL(appUrlRaw);
    } catch {
      throw new StripeConfigError("APP_URL must be an absolute http or https URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new StripeConfigError("APP_URL must be an absolute http or https URL.");
    }
    appUrl = parsed.origin;
  }

  return { secretKey, webhookSecret, platformFeeBps, appUrl };
}
