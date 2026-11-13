"use client";

import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { TestingGuideButton } from "@/components/layout/testing-guide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformFeeNotice } from "@/lib/platform-fee";
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

type PayoutState = "unknown" | "not_connected" | "incomplete" | "review" | "ready";

function payoutState(status: PublicSellerStatus | null | undefined): PayoutState {
  if (status === undefined) return "unknown";
  if (status === null) return "not_connected";
  if (status.charges_enabled) return "ready";
  if (!status.details_submitted) return "incomplete";
  return "review";
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatConnectedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMAT.format(date);
}

const BADGE_STYLES = {
  gray: "bg-gray-100 text-gray-700",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-brand-soft text-brand-ink",
  green: "bg-green-100 text-green-800",
} as const;

function StatusBadge({
  tone,
  children,
}: {
  tone: keyof typeof BADGE_STYLES;
  children: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

function ProgressChecklist({ status }: { status: PublicSellerStatus | null }) {
  const steps = [
    { label: "Connect a Stripe account", done: status !== null },
    { label: "Submit your details", done: Boolean(status?.details_submitted) },
    { label: "Accept payments", done: Boolean(status?.charges_enabled) },
    { label: "Payouts to your bank", done: Boolean(status?.payouts_enabled) },
  ];
  return (
    <ol aria-label="Setup progress" className="space-y-2 rounded-lg bg-gray-50 p-3">
      {steps.map((step) => {
        const Icon = step.done ? CheckCircle2 : Circle;
        return (
          <li key={step.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-gray-700">
              <Icon
                className={`h-4 w-4 shrink-0 ${step.done ? "text-green-600" : "text-gray-400"}`}
                aria-hidden="true"
              />
              {step.label}
            </span>
            <span
              className={`shrink-0 text-xs font-medium ${step.done ? "text-green-700" : "text-gray-500"}`}
            >
              {step.done ? "Done" : "To do"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

const PRIMARY_BUTTON =
  "h-11 w-full bg-brand-strong px-4 text-white hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand sm:w-auto";
const SECONDARY_BUTTON =
  "h-11 w-full px-4 focus-visible:ring-2 focus-visible:ring-brand sm:w-auto";

export function SellerPaymentsPanel({
  platformFeeBps,
}: {
  platformFeeBps: number | null;
}) {
  const feeNotice =
    platformFeeBps === null ? null : platformFeeNotice(platformFeeBps);
  const searchParams = useSearchParams();
  const onboarding = searchParams.get("onboarding");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<PublicSellerStatus | null | undefined>(
    undefined,
  );
  const [pending, setPending] = useState(false);
  const [pendingKind, setPendingKind] = useState<"status" | "onboard">("status");
  const [error, setError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const pendingRef = useRef(false);
  const autoRan = useRef(false);
  // Latest request number; responses from older requests are ignored.
  const requestSeq = useRef(0);
  // Normalized email currently in the input, kept in sync with the input value.
  const currentEmail = useRef("");

  useEffect(() => {
    // Restored from the back/forward cache after redirecting: drop the stale request state.
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      requestSeq.current += 1;
      pendingRef.current = false;
      setPending(false);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const request = useCallback(
    async (
      init: RequestInit,
      url: string,
      forEmail: string,
      kind: "status" | "onboard",
    ) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      const seq = ++requestSeq.current;
      setPendingKind(kind);
      setPending(true);
      setError(null);

      const isStale = () =>
        seq !== requestSeq.current || forEmail !== currentEmail.current;

      let redirecting = false;
      try {
        const response = await fetch(url, init);
        const data = (await response
          .json()
          .catch(() => null)) as ApiResponse | null;

        if (isStale()) return;

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
        if (!isStale()) setError(FALLBACK_ERROR);
      } finally {
        if (!redirecting && seq === requestSeq.current) {
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
        value,
        "status",
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
        value,
        "onboard",
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
    if (stored) {
      setEmail(stored);
      currentEmail.current = stored.toLowerCase();
    }

    if (!stored || !isValidEmail(stored.toLowerCase())) {
      if (onboarding === "return" || onboarding === "refresh") {
        setError("Enter your seller email to continue.");
      }
      return;
    }

    if (onboarding === "return") {
      setWelcome(true);
      void checkStatus(stored.toLowerCase());
    } else if (onboarding === "refresh") {
      void startOnboarding(stored.toLowerCase());
    } else {
      void checkStatus(stored.toLowerCase());
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

  function refreshStatus() {
    const value = validEmail();
    if (value) {
      setWelcome(false);
      void checkStatus(value);
    }
  }

  function handleCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    refreshStatus();
  }

  function handleOnboard() {
    const value = validEmail();
    if (value) void startOnboarding(value);
  }

  const state = payoutState(status);
  const checking = pending && pendingKind === "status";
  const onboardPending = pending && pendingKind === "onboard";
  // Status is cleared whenever the input changes, so a shown status always belongs to this email.
  const shownEmail = email.trim().toLowerCase();

  return (
    <div className="space-y-4">
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
                currentEmail.current = event.target.value.trim().toLowerCase();
                setStatus(undefined);
                setWelcome(false);
              }}
              placeholder="you@example.com"
              className="h-11"
              aria-describedby={
                error
                  ? `payments-seller-email-help ${ERROR_ID}`
                  : "payments-seller-email-help"
              }
              aria-invalid={Boolean(error) && !isValidEmail(email.trim().toLowerCase())}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={pending}
            className={SECONDARY_BUTTON}
          >
            {checking ? "Checking…" : "Check status"}
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

        <div
          role="region"
          aria-label="Payout status"
          aria-live="polite"
          aria-busy={checking}
        >
          {checking && state === "unknown" ? (
            <div className="space-y-3 rounded-lg border border-gray-200 p-4">
              <div className="h-5 w-24 animate-pulse rounded-full bg-gray-200" />
              <div className="h-5 w-3/4 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
              <span className="sr-only">Checking your payout status…</span>
            </div>
          ) : state === "unknown" ? (
            <p className="text-sm text-gray-500">
              Enter the email you list items with to see your payout status.
            </p>
          ) : state === "ready" && status ? (
            <div className="overflow-hidden rounded-lg border border-green-200">
              <div className="flex items-start gap-3 bg-green-50 p-4">
                <CheckCircle2
                  className="mt-0.5 h-6 w-6 shrink-0 text-green-600"
                  aria-hidden="true"
                />
                <div className="min-w-0 space-y-1">
                  <StatusBadge tone="green">Ready</StatusBadge>
                  <h2 className="text-lg font-semibold text-gray-900">
                    You&apos;re all set
                  </h2>
                  <p className="text-sm text-gray-700">
                    Buyers can pay for your listings with Buy Now, and the money
                    goes to your Stripe account.
                  </p>
                </div>
              </div>
              <div className="space-y-4 p-4">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DetailRow label="Seller email">
                    <span className="break-all">{shownEmail}</span>
                  </DetailRow>
                  <DetailRow label="Stripe account">
                    <span className="font-mono">{status.account_hint}</span>
                  </DetailRow>
                  <DetailRow label="Connected on">
                    {formatConnectedAt(status.connected_at)}
                  </DetailRow>
                  <DetailRow label="Receiving payments">Active</DetailRow>
                  <DetailRow label="Payouts">
                    {status.payouts_enabled ? "Active" : "Pending"}
                  </DetailRow>
                  <DetailRow label="Mode">Sandbox (test mode)</DetailRow>
                  {status.active_listings !== undefined ? (
                    <DetailRow label="Listings for sale">
                      {status.active_listings}
                    </DetailRow>
                  ) : null}
                </dl>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild className={PRIMARY_BUTTON}>
                    <Link href="/your-listings">View your listings</Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={refreshStatus}
                    disabled={pending}
                    className={SECONDARY_BUTTON}
                  >
                    {checking ? "Checking…" : "Refresh status"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-gray-200 p-4">
              <div className="space-y-1">
                {state === "not_connected" ? (
                  <>
                    <StatusBadge tone="gray">Not set up</StatusBadge>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Payouts aren&apos;t set up yet
                    </h2>
                    <p className="text-sm text-gray-700">
                      Buyers can&apos;t pay for listings from{" "}
                      <span className="break-all font-medium">{shownEmail}</span>{" "}
                      until you connect a Stripe account. With Stripe&apos;s test
                      data it takes about two minutes.
                    </p>
                  </>
                ) : state === "incomplete" ? (
                  <>
                    <StatusBadge tone="amber">Setup incomplete</StatusBadge>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Finish your Stripe setup
                    </h2>
                    <p className="text-sm text-gray-700">
                      Stripe still needs a few details before buyers can pay you.
                    </p>
                  </>
                ) : (
                  <>
                    <StatusBadge tone="blue">In review</StatusBadge>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Stripe is reviewing your details
                    </h2>
                    <p className="text-sm text-gray-700">
                      This usually takes a moment in the sandbox.
                    </p>
                  </>
                )}
              </div>

              <ProgressChecklist status={status ?? null} />

              {state === "review" ? (
                <Button
                  type="button"
                  onClick={refreshStatus}
                  disabled={pending}
                  className={PRIMARY_BUTTON}
                >
                  {checking ? "Checking…" : "Refresh status"}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleOnboard}
                  disabled={pending}
                  className={PRIMARY_BUTTON}
                >
                  {onboardPending
                    ? "Working…"
                    : state === "not_connected"
                      ? "Connect with Stripe"
                      : "Continue setup"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 px-1">
        {feeNotice && <p className="text-xs text-gray-500">{feeNotice}</p>}
        <p className="text-xs text-gray-500">
          Demo only: payouts are linked to the email you enter, not to a login.
          Use Stripe test data during onboarding.
        </p>
        <TestingGuideButton variant="link" />
      </div>
    </div>
  );
}
