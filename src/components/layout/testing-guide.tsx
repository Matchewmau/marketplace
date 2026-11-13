"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, CircleHelp, Copy, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ONBOARDING_VALUES,
  QUICK_START,
  TEST_CARDS,
  TESTING_TIPS,
  type GuideValue,
} from "@/lib/testing-guide";

function GuideRow({
  item,
  copied,
  onCopy,
}: {
  item: GuideValue;
  copied: boolean;
  onCopy: (item: GuideValue) => void;
}) {
  return (
    <li className="py-2">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <span className="text-sm text-gray-600">{item.label}</span>
        <div className="flex min-w-0 items-center gap-2 sm:justify-end">
          <span className="min-w-0 break-words font-mono text-sm text-gray-900 sm:text-right">
            {item.value}
          </span>
          {item.copy ? (
            <button
              type="button"
              onClick={() => onCopy(item)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[#1877F2] hover:bg-[#E7F3FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
              <span className="sr-only"> {item.label}</span>
            </button>
          ) : null}
        </div>
      </div>
      {item.note ? (
        <p className="mt-0.5 text-xs text-gray-500">{item.note}</p>
      ) : null}
    </li>
  );
}

function GuideSection({
  title,
  items,
  copiedKey,
  onCopy,
}: {
  title: string;
  items: GuideValue[];
  copiedKey: string | null;
  onCopy: (item: GuideValue) => void;
}) {
  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <ul className="mt-1 divide-y divide-gray-100">
        {items.map((item) => (
          <GuideRow
            key={item.label}
            item={item}
            copied={copiedKey === item.label}
            onCopy={onCopy}
          />
        ))}
      </ul>
    </section>
  );
}

export function TestingGuideButton({
  variant = "icon",
}: {
  variant?: "icon" | "link";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function openDialog() {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  function announce(message: string, key: string | null, durationMs: number) {
    setCopiedKey(key);
    setAnnouncement(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopiedKey(null);
      setAnnouncement("");
    }, durationMs);
  }

  async function handleCopy(item: GuideValue) {
    if (!item.copy) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(item.copy);
    } catch {
      announce("Copy failed — select the text instead", null, 3000);
      return;
    }
    announce(`Copied ${item.label}`, item.label, 1500);
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          aria-label="Testing guide"
          title="How to test payments"
          aria-haspopup="dialog"
          onClick={openDialog}
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40"
        >
          <CircleHelp className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={openDialog}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-[#1877F2] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40"
        >
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
          How to test payments
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className={cn(
          "m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/40",
        )}
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id={titleId}
                className="text-lg font-semibold text-gray-900"
              >
                Testing guide
              </h2>
              <p className="mt-0.5 text-sm text-gray-600">
                Use Stripe&apos;s test data — nothing here charges real money.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dialogRef.current?.close()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <section className="mt-5">
            <h3 className="text-sm font-semibold text-gray-800">Quick start</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
              {QUICK_START.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <GuideSection
            title="Test cards"
            items={TEST_CARDS}
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />
          <GuideSection
            title="Seller onboarding (Stripe test data)"
            items={ONBOARDING_VALUES}
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />

          <section className="mt-5">
            <h3 className="text-sm font-semibold text-gray-800">Tips</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-gray-700">
              {TESTING_TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </section>

          <div
            aria-live="polite"
            className={
              announcement && !copiedKey ? "mt-4 text-sm text-red-600" : "sr-only"
            }
          >
            {announcement}
          </div>
        </div>
      </dialog>
    </>
  );
}
