"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { BackLink } from "@/components/layout/back-link";
import { ImageWithFallback } from "@/components/marketplace/image-with-fallback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPrice, formatRelativeTime } from "@/lib/format";
import type { InboxMessage } from "@/lib/types";
import { isValidEmail } from "@/lib/validation";

type InboxGroup = {
  listingId: string;
  listingTitle: string;
  listingImageUrl: string | null;
  listingPrice: number;
  messages: InboxMessage[];
};

function groupMessages(messages: InboxMessage[]): InboxGroup[] {
  const groups: InboxGroup[] = [];
  const byListing = new Map<string, InboxGroup>();

  for (const message of messages) {
    let group = byListing.get(message.listing_id);

    if (!group) {
      group = {
        listingId: message.listing_id,
        listingTitle: message.listing_title,
        listingImageUrl: message.listing_image_url,
        listingPrice: message.listing_price,
        messages: [],
      };
      byListing.set(message.listing_id, group);
      groups.push(group);
    }

    group.messages.push(message);
  }

  return groups;
}

function InboxSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/[0.03]"
        >
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 animate-pulse rounded-lg bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200" />
            </div>
          </div>
          <div className="mt-4 h-3 w-full animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

export default function MessagesPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fetchVersion, setFetchVersion] = useState(0);

  useEffect(() => {
    try {
      const stored = localStorage
        .getItem("marketplace_seller_email")
        ?.trim()
        .toLowerCase();

      if (stored && isValidEmail(stored)) {
        setEmail(stored);
        setEmailInput(stored);
        setMessages([]);
        setLoading(true);
        setError(null);
      }
    } catch {
      // localStorage can be unavailable; the email form still works.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!email) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    const sellerEmail = email;
    const controller = new AbortController();

    setMessages([]);
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const response = await fetch(
          `/api/messages?sellerEmail=${encodeURIComponent(sellerEmail)}`,
          { signal: controller.signal },
        );
        const data = (await response.json().catch(() => null)) as {
          messages?: InboxMessage[];
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(data?.error ?? "Failed to load messages");
        }

        setMessages(data?.messages ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Failed to load messages",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [email, fetchVersion]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = emailInput.trim().toLowerCase();

    if (!isValidEmail(value)) {
      setFormError("Enter a valid email address.");
      return;
    }

    try {
      localStorage.setItem("marketplace_seller_email", value);
    } catch {
      // Storage can be unavailable in private browsing.
    }

    setFormError(null);
    setMessages([]);
    setLoading(true);
    setError(null);
    setEmail(value);
    setFetchVersion((current) => current + 1);
  }

  const groups = groupMessages(messages);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink />

      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/[0.03] sm:p-6">
        <h1 className="text-2xl font-semibold text-gray-800">Messages</h1>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Messages sent to the email you use when posting. The email is
          remembered in this browser, but anyone who knows it can view these
          messages from any browser. This is not an account, so do not use it
          for sensitive messages.
        </p>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-sm">
            <Label htmlFor="messages-seller-email">Email</Label>
            <Input
              id="messages-seller-email"
              type="email"
              value={emailInput}
              onChange={(event) => {
                setEmailInput(event.target.value);
                if (formError) {
                  setFormError(null);
                }
              }}
              placeholder="you@example.com"
              aria-invalid={Boolean(formError)}
              aria-describedby={
                formError ? "messages-email-error" : undefined
              }
            />
          </div>
          <Button
            type="submit"
            className="bg-brand-strong text-white hover:bg-brand-hover"
          >
            View messages
          </Button>
        </form>

        {formError ? (
          <p
            id="messages-email-error"
            role="alert"
            className="mt-2 text-xs text-red-600"
          >
            {formError}
          </p>
        ) : null}

        {email ? (
          <p className="mt-3 break-all text-xs text-gray-500">
            Showing messages for{" "}
            <span className="font-medium text-gray-700">{email}</span>.
          </p>
        ) : null}
      </div>

      {!ready ? (
        <div
          role="status"
          className="rounded-xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm ring-1 ring-black/[0.03]"
        >
          Loading your inbox…
        </div>
      ) : !email ? (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]">
          <Inbox className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-3 text-sm text-gray-600">
            Enter your email above to see messages sent to your listings.
          </p>
        </div>
      ) : loading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading messages…</span>
          <InboxSkeleton />
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]"
        >
          <p className="text-sm text-red-600">{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setFetchVersion((current) => current + 1)}
          >
            Try again
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]">
          <Inbox className="mx-auto h-8 w-8 text-gray-400" />
          <h2 className="mt-3 text-lg font-semibold text-gray-800">
            No messages yet
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Messages sent from your listings will appear here.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              asChild
              className="bg-brand-strong text-white hover:bg-brand-hover"
            >
              <Link href="/your-listings">View your listings</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/create">Create a listing</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <section
              key={group.listingId}
              className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/[0.03]"
            >
              <div className="flex items-center gap-3 border-b border-gray-100 p-4">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  <ImageWithFallback
                    src={group.listingImageUrl}
                    alt={group.listingTitle}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/item/${group.listingId}`}
                    className="block truncate font-medium text-gray-800 transition-colors hover:text-brand-hover hover:underline"
                  >
                    {group.listingTitle}
                  </Link>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {formatPrice(group.listingPrice)} ·{" "}
                    {group.messages.length}{" "}
                    {group.messages.length === 1 ? "message" : "messages"}
                  </p>
                </div>
              </div>

              <ul className="divide-y divide-gray-100">
                {group.messages.map((message) => (
                  <li key={message.id} className="p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <a
                        href={`mailto:${message.buyer_email}`}
                        className="break-all text-sm font-medium text-brand-ink hover:underline"
                      >
                        {message.buyer_email}
                      </a>
                      <time
                        dateTime={message.created_at}
                        className="shrink-0 text-xs text-gray-500"
                      >
                        {formatRelativeTime(message.created_at)}
                      </time>
                    </div>
                    <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-gray-700">
                      {message.message}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
