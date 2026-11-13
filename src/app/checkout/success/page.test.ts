import React, { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import CheckoutSuccessPage from "./page";

vi.mock("@/lib/fulfillment", () => ({ fulfillCheckoutSession: vi.fn() }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/components/marketplace/clear-hold-token", () => ({ ClearHoldToken: () => null }));

// Vitest compiles JSX with the classic runtime, which needs React in scope.
globalThis.React = React;

// Collects every string in a React element tree (no DOM needed for these static panels).
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: unknown; title?: string }>;
    return [el.props.title, textOf(el.props.children)].filter(Boolean).join(" ");
  }
  return "";
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getStripe).mockReset().mockReturnValue({} as ReturnType<typeof getStripe>);
  vi.mocked(getSupabaseAdmin).mockReset().mockReturnValue({} as ReturnType<typeof getSupabaseAdmin>);
  vi.mocked(fulfillCheckoutSession).mockReset();
});

describe("CheckoutSuccessPage", () => {
  it("shows the confirming message when fulfilment fails", async () => {
    vi.mocked(fulfillCheckoutSession).mockRejectedValue(new Error("db down"));
    const page = await CheckoutSuccessPage({
      searchParams: Promise.resolve({ session_id: "cs_test_abc123" }),
    });
    const text = textOf(page);
    expect(text).toContain("Confirming your payment");
    expect(text).toContain("We're confirming your payment");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("db down");
  });
});
