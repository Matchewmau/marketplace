"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTrustedStripeUrl } from "@/lib/stripe/redirect";
import type { PublicSellerStatus } from "@/lib/types";
import { isValidEmail } from "@/lib/validation";

const STORAGE_KEY = "marketplace_seller_email";
const FALLBACK_ERROR = "Something went wrong. Try again.";
const ERROR_ID = "payments-seller-email-error";

type ApiResponse = {
  url?: string;
  status?: PublicSellerStatus | null;
  error?: string;
};

function StatusRow({ label, value }: { label: string; value: boolean }) {
  const Icon = value ? CheckCircle2 : Circle;
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-gray-700">
        <Icon
          className={`h-4 w-4 ${value ? "text-green-600" : "text-gray-400"}`}
          aria-hidden="true"
        />
        {label}
      </span>
      <span className="font-medium text-gray-800">
        {value ? "Yes" : "Not yet"}
      </span>
    </li>
  );
}

export function SellerPaymentsPanel() {
  const searchParams = useSearchParams();
  const onboarding = searchParams.get("onboarding");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<PublicSellerStatus | null | undefined>(
    undefined,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const pendingRef = useRef(false);
  const autoRan = useRef(false);

  const request = useCallback(
    async (init: RequestInit, url: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setError(null);

      let redirecting = false;
      try {
        const response = await fetch(url, init);
        const data = (await response
          .json()
          .catch(() => null)) as ApiResponse | null;

        if (!response.ok || !data || data.error) {
          setError(data?.error ?? FALLBACK_ERROR);
          return;
        }

        if (data.url !== undefined) {
          if (!isTrustedStripeUrl(data.url)) {
            setError(FALLBACK_ERROR);
            return;
          }
          redirecting = true;
          window.location.assign(data.url);
          return;
        }

        if ("status" in data) {
          setStatus(data.status ?? null);
        }
      } catch {
        setError(FALLBACK_ERROR);
      } finally {
        if (!redirecting) {
          pendingRef.current = false;
          setPending(false);
        }
      }
    },
    [],
  );

  const checkStatus = useCallback(
    (value: string) =>
      request(
        {},
        `/api/stripe/connect/status?email=${encodeURIComponent(value)}`,
      ),
    [request],
  );

  const startOnboarding = useCallback(
    (value: string) =>
      request(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: value }),
        },
        "/api/stripe/connect/onboard",
      ),
    [request],
  );

  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;

    let stored = "";
    try {
      stored = localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    } catch {
      // localStorage can be unavailable; the form still works.
    }
    if (stored) setEmail(stored);

    if (!stored || !isValidEmail(stored.toLowerCase())) {
      if (onboarding === "return" || onboarding === "refresh") {
        setError("Enter your seller email to continue.");
      }
      return;
    }

    if (onboarding === "return") {
      setWelcome(true);
      void checkStatus(stored);
    } else if (onboarding === "refresh") {
      void startOnboarding(stored);
    }
  }, [onboarding, checkStatus, startOnboarding]);

  function validEmail(): string | null {
    const value = email.trim().toLowerCase();
    if (!isValidEmail(value)) {
      setError("Enter a valid email address.");
      return null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage can be unavailable in private browsing.
    }
    return value;
  }

  function handleCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = validEmail();
    if (value) {
      setWelcome(false);
      void checkStatus(value);
    }
  }

  function handleOnboard() {
    const value = validEmail();
    if (value) void startOnboarding(value);
  }

  const showPrimary = status === undefined || status === null
    ? true
    : !status.details_submitted;
  const primaryLabel =
    status === undefined || status === null
      ? "Set up payouts with Stripe"
      : "Continue onboarding";

  return (
    <div className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/[0.03]">
      {welcome ? (
        <p className="text-sm font-medium text-gray-800">
          Welcome back from Stripe.
        </p>
      ) : null}

      <form
        onSubmit={handleCheck}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="payments-seller-email">Seller email</Label>
          <Input
            id="payments-seller-email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setStatus(undefined);
              setWelcome(false);
            }}
            placeholder="you@example.com"
            aria-describedby={
              error
                ? `payments-seller-email-help ${ERROR_ID}`
                : "payments-seller-email-help"
            }
            aria-invalid={Boolean(error) && !isValidEmail(email.trim().toLowerCase())}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Check status
        </Button>
      </form>
      <p id="payments-seller-email-help" className="text-xs text-gray-500">
        Use the same email you list items with.
      </p>

      {error ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {status === null ? (
        <p className="text-sm text-gray-600">
          No payout account found for this email yet.
        </p>
      ) : null}

      {status ? (
        <ul
          aria-label="Payment status"
          className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4"
        >
          <StatusRow label="Details submitted" value={status.details_submitted} />
          <StatusRow label="Can receive payments" value={status.charges_enabled} />
          <StatusRow label="Payouts enabled" value={status.payouts_enabled} />
        </ul>
      ) : null}

      {showPrimary ? (
        <Button
          type="button"
          onClick={handleOnboard}
          disabled={pending}
          className="bg-[#1877F2] text-white hover:bg-[#166FE5]"
        >
          {pending ? "Working…" : primaryLabel}
        </Button>
      ) : (
        <p className="text-sm font-medium text-gray-800">
          {status?.charges_enabled
            ? "You're all set. Buyers can now pay for your listings."
            : "Stripe is reviewing your details."}
        </p>
      )}

      <p className="text-xs text-gray-500">
        Demo only: payouts are linked to the email you enter, not to a login.
        Use Stripe test data during onboarding.
      </p>
    </div>
  );
}
