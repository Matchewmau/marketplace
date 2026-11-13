"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Check,
  CheckCircle2,
  CircleHelp,
  Copy,
  CreditCard,
  Info,
  Lightbulb,
  ListChecks,
  ShieldCheck,
  Store,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ONBOARDING_VALUES,
  QUICK_START,
  TEST_CARDS,
  TESTING_TIPS,
  type GuideValue,
} from "@/lib/testing-guide";

type CopyState = "idle" | "copied" | "failed";
type Feedback = { key: string; state: CopyState } | null;
type TabKey = "quick" | "cards" | "seller" | "tips";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "quick", label: "Quick start", icon: ListChecks },
  { key: "cards", label: "Test cards", icon: CreditCard },
  { key: "seller", label: "Seller setup", icon: Store },
  { key: "tips", label: "Tips", icon: Lightbulb },
];

const TONES: Record<
  NonNullable<GuideValue["tone"]>,
  { label: string; icon: LucideIcon; className: string }
> = {
  success: {
    label: "Succeeds",
    icon: CheckCircle2,
    className: "bg-green-50 text-green-800",
  },
  danger: {
    label: "Declined",
    icon: XCircle,
    className: "bg-red-50 text-red-800",
  },
  warning: {
    label: "3D Secure",
    icon: ShieldCheck,
    className: "bg-amber-50 text-amber-800",
  },
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const stateFor = (feedback: Feedback, item: GuideValue): CopyState =>
  feedback?.key === item.label ? feedback.state : "idle";

function CopyButton({
  item,
  state,
  onCopy,
}: {
  item: GuideValue;
  state: CopyState;
  onCopy: (item: GuideValue) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(item)}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-brand-ink hover:bg-brand-soft",
        FOCUS_RING,
      )}
    >
      {state === "copied" ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Copy failed"
          : "Copy"}
      <span className="sr-only"> {item.label}</span>
    </button>
  );
}

function QuickStartPanel({
  onShowTab,
}: {
  onShowTab: (key: TabKey) => void;
}) {
  const links: Partial<Record<number, { label: string; tab: TabKey }>> = {
    1: { label: "See seller setup values", tab: "seller" },
    3: { label: "See test cards", tab: "cards" },
  };
  return (
    <ol className="space-y-4">
      {QUICK_START.map((step, index) => {
        const link = links[index];
        return (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink"
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm text-gray-800">{step}</p>
              {link ? (
                <button
                  type="button"
                  onClick={() => onShowTab(link.tab)}
                  className={cn(
                    "-ml-1 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium text-brand-ink hover:underline",
                    FOCUS_RING,
                  )}
                >
                  {link.label}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TestCardsPanel({
  feedback,
  onCopy,
}: {
  feedback: Feedback;
  onCopy: (item: GuideValue) => void;
}) {
  const cards = TEST_CARDS.filter((item) => item.tone);
  const fields = TEST_CARDS.filter((item) => item.instruction);
  return (
    <div>
      <ul className="space-y-3">
        {cards.map((item) => {
          const tone = TONES[item.tone!];
          const ToneIcon = tone.icon;
          return (
            <li key={item.label} className="rounded-xl p-3 ring-1 ring-gray-200">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    tone.className,
                  )}
                >
                  <ToneIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {tone.label}
                </span>
                <span className="text-sm text-gray-600">{item.label}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-base font-semibold tracking-wider text-gray-900 ring-1 ring-gray-200">
                  {item.value}
                </span>
                {item.copy ? (
                  <CopyButton
                    item={item}
                    state={stateFor(feedback, item)}
                    onCopy={onCopy}
                  />
                ) : null}
              </div>
              {item.note ? (
                <p className="mt-1 text-xs text-gray-500">{item.note}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-800">Other fields</h3>
      <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {fields.map((item) => (
          <div key={item.label} className="rounded-lg bg-gray-50 p-3">
            <dt className="text-xs text-gray-600">{item.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-gray-900">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SellerGroup({
  title,
  items,
  feedback,
  onCopy,
}: {
  title: string;
  items: GuideValue[];
  feedback: Feedback;
  onCopy: (item: GuideValue) => void;
}) {
  return (
    <section className="rounded-xl p-3 ring-1 ring-gray-200">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <ul className="mt-1 divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.label} className="py-2">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="text-sm text-gray-600">{item.label}</span>
              {item.instruction || !item.copy ? (
                <span className="min-w-0 break-words text-sm text-gray-900 sm:text-right">
                  {item.value}
                </span>
              ) : (
                <div className="flex min-w-0 items-center gap-1 sm:justify-end">
                  <span className="min-w-0 break-all rounded-md bg-gray-50 px-2 py-1 font-mono text-sm text-gray-900 ring-1 ring-gray-200">
                    {item.value}
                  </span>
                  <CopyButton
                    item={item}
                    state={stateFor(feedback, item)}
                    onCopy={onCopy}
                  />
                </div>
              )}
            </div>
            {item.note ? (
              <p className="mt-0.5 text-xs text-gray-500">{item.note}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SellerSetupPanel({
  feedback,
  onCopy,
}: {
  feedback: Feedback;
  onCopy: (item: GuideValue) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        Use these on Stripe&apos;s onboarding pages after clicking Set up
        payouts.
      </p>
      <SellerGroup
        title="Identity"
        items={ONBOARDING_VALUES.filter((item) => item.group === "identity")}
        feedback={feedback}
        onCopy={onCopy}
      />
      <SellerGroup
        title="Payout bank"
        items={ONBOARDING_VALUES.filter((item) => item.group === "bank")}
        feedback={feedback}
        onCopy={onCopy}
      />
    </div>
  );
}

function TipsPanel() {
  return (
    <ul className="space-y-2">
      {TESTING_TIPS.map((tip) => (
        <li
          key={tip}
          className="flex gap-2 rounded-lg bg-brand-soft/60 p-3 text-sm text-gray-800"
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-brand"
            aria-hidden="true"
          />
          <span className="min-w-0">{tip}</span>
        </li>
      ))}
    </ul>
  );
}

export function TestingGuideButton({
  variant = "icon",
}: {
  variant?: "icon" | "link";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const idPrefix = useId();
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>(
    {},
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("quick");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Lock background scroll while the modal is open. Each instance saves the
  // values it found and restores them on close or unmount; only one dialog
  // can be open at a time, so the saved values are always the originals.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousGutter = root.style.scrollbarGutter;
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "stable";
    return () => {
      root.style.overflow = previousOverflow;
      root.style.scrollbarGutter = previousGutter;
    };
  }, [open]);

  const tabId = (key: TabKey) => `${idPrefix}-tab-${key}`;
  const panelId = (key: TabKey) => `${idPrefix}-panel-${key}`;

  function openDialog() {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      setActiveTab("quick");
      dialog.showModal();
      setOpen(true);
    }
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function selectTab(key: TabKey, focus: boolean) {
    setActiveTab(key);
    if (focus) tabRefs.current[key]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((tab) => tab.key === activeTab);
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % TABS.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectTab(TABS[next].key, true);
  }

  function announce(
    message: string,
    key: string,
    state: CopyState,
    durationMs: number,
  ) {
    setFeedback({ key, state });
    setAnnouncement(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setFeedback(null);
      setAnnouncement("");
    }, durationMs);
  }

  async function handleCopy(item: GuideValue) {
    if (!item.copy) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(item.copy);
    } catch {
      announce(`Copy failed for ${item.label}`, item.label, "failed", 3000);
      return;
    }
    announce(`Copied ${item.label}`, item.label, "copied", 1500);
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
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <CircleHelp className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={openDialog}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
          How to test payments
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDialog();
        }}
        className="m-auto max-h-[min(88vh,760px)] w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-2xl bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/50 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
      >
        <div className="flex max-h-[inherit] flex-col">
          <div className="shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                <CircleHelp className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2
                    id={titleId}
                    className="text-lg font-semibold text-gray-900"
                  >
                    Testing guide
                  </h2>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Sandbox · no real money
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-gray-600">
                  Use Stripe&apos;s test data to try the whole buy-and-sell
                  flow.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={closeDialog}
                className={cn(
                  "-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100",
                  FOCUS_RING,
                )}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div
              role="tablist"
              aria-label="Testing guide sections"
              onKeyDown={handleTabKeyDown}
              className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1"
            >
              {TABS.map((tab) => {
                const selected = tab.key === activeTab;
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    ref={(node) => {
                      tabRefs.current[tab.key] = node;
                    }}
                    type="button"
                    role="tab"
                    id={tabId(tab.key)}
                    aria-selected={selected}
                    aria-controls={panelId(tab.key)}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectTab(tab.key, false)}
                    className={cn(
                      "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors sm:flex-1",
                      FOCUS_RING,
                      selected
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900",
                    )}
                  >
                    <TabIcon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            role="tabpanel"
            id={panelId(activeTab)}
            aria-labelledby={tabId(activeTab)}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-5"
          >
            {activeTab === "quick" ? (
              <QuickStartPanel onShowTab={(key) => selectTab(key, true)} />
            ) : activeTab === "cards" ? (
              <TestCardsPanel feedback={feedback} onCopy={handleCopy} />
            ) : activeTab === "seller" ? (
              <SellerSetupPanel feedback={feedback} onCopy={handleCopy} />
            ) : (
              <TipsPanel />
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 sm:px-5">
            <p className="text-xs text-gray-500">
              Values from Stripe&apos;s test documentation.
            </p>
            <button
              type="button"
              onClick={closeDialog}
              className={cn(
                "inline-flex h-11 shrink-0 items-center rounded-lg bg-white px-4 text-sm font-medium text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50",
                FOCUS_RING,
              )}
            >
              Done
            </button>
          </div>

          <div aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </div>
      </dialog>
    </>
  );
}
