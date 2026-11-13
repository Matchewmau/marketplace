"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Message } from "@/lib/types";
import { isValidEmail } from "@/lib/validation";

const DEFAULT_MESSAGE = "I’m interested in your item!";

type MessageSellerFormProps = {
  listingId: string;
};

export function MessageSellerForm({ listingId }: MessageSellerFormProps) {
  const [buyerEmail, setBuyerEmail] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    const email = buyerEmail.trim().toLowerCase();
    const text = message.trim();

    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    if (text.length < 1 || text.length > 2000) {
      setError("Message must be between 1 and 2000 characters.");
      return;
    }

    setSending(true);

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_id: listingId,
          buyer_email: email,
          message: text,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        message?: Message;
        error?: string;
      } | null;

      if (!response.ok || !data?.message) {
        throw new Error(data?.error ?? "Failed to send message");
      }

      setMessage("");
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      {success ? (
        <div
          role="status"
          className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700"
        >
          Message sent successfully!
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="message-buyer-email">Your email</Label>
        <Input
          id="message-buyer-email"
          type="email"
          value={buyerEmail}
          onChange={(event) => setBuyerEmail(event.target.value)}
          placeholder="you@example.com"
          aria-invalid={Boolean(error)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="message-body">Message</Label>
        <Textarea
          id="message-body"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={4}
          maxLength={2000}
          aria-invalid={Boolean(error)}
        />
      </div>

      <Button
        type="submit"
        disabled={sending}
        className="w-full bg-brand-strong text-white hover:bg-brand-hover"
      >
        {sending ? "Sending…" : "Send Message"}
      </Button>
    </form>
  );
}
