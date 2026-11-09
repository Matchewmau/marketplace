"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { ListingBrowser } from "@/components/marketplace/listing-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidEmail } from "@/lib/validation";

export default function YourListingsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage
        .getItem("marketplace_seller_email")
        ?.trim();

      if (stored) {
        setEmail(stored);
        setEmailInput(stored);
      }
    } catch {
      // localStorage can be unavailable; the email form still works.
    } finally {
      setReady(true);
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = emailInput.trim().toLowerCase();

    if (!isValidEmail(value)) {
      setError("Enter a valid email address.");
      return;
    }

    try {
      localStorage.setItem("marketplace_seller_email", value);
    } catch {
      // Storage can be unavailable in private browsing.
    }

    setEmail(value);
    setError(null);
  }

  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <Sidebar />
      <div className="min-w-0 space-y-4">
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">
            Your listings are tied to the email you use when posting. This
            is browser-local, not an account.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-sm">
              <Label htmlFor="seller-email">Email</Label>
              <Input
                id="seller-email"
                type="email"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                placeholder="you@example.com"
                aria-invalid={Boolean(error)}
              />
            </div>
            <Button
              type="submit"
              className="bg-[#1877F2] text-white hover:bg-[#166FE5]"
            >
              View my listings
            </Button>
          </form>

          {error ? (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          ) : null}

          {email ? (
            <p className="mt-3 break-all text-xs text-gray-500">
              Showing listings for{" "}
              <span className="font-medium text-gray-700">{email}</span>.
            </p>
          ) : null}
        </div>

        {ready ? (
          email ? (
            <ListingBrowser
              sellerEmail={email}
              showFilters={false}
              heading="Your listings"
              emptyMessage="No listings for this email"
            />
          ) : (
            <div className="rounded-lg bg-white p-8 text-center text-sm text-gray-600 shadow-sm">
              Enter your email to see listings you created in this browser.
            </div>
          )
        ) : (
          <div className="rounded-lg bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            Loading your listings…
          </div>
        )}
      </div>
    </div>
  );
}
