export type GuideValue = {
  label: string;
  value: string;
  copy?: string;
  note?: string;
  /** Outcome of a test card, shown as a status pill. */
  tone?: "success" | "danger" | "warning";
  /** Which seller-setup card the row belongs to. */
  group?: "identity" | "bank";
  /** The value is an instruction to read, not a code to copy or type. */
  instruction?: boolean;
};

export const QUICK_START: string[] = [
  "Create a listing with your email (price $0.50 or more).",
  "Open Get paid, enter the same email, click Connect with Stripe, and use the Stripe test values below.",
  "Open the listing in a private window or another browser and click Buy Now.",
  "Pay with a test card. You'll see “Order confirmed” and the item is marked Sold.",
];

export const TEST_CARDS: GuideValue[] = [
  {
    label: "Payment succeeds",
    value: "4242 4242 4242 4242",
    copy: "4242424242424242",
    tone: "success",
  },
  {
    label: "Card is declined",
    value: "4000 0000 0000 0002",
    copy: "4000000000000002",
    tone: "danger",
  },
  {
    label: "Needs 3D Secure",
    value: "4000 0027 6000 3184",
    copy: "4000002760003184",
    tone: "warning",
  },
  {
    label: "Expiry date",
    value: "Any future date, e.g. 12/34",
    instruction: true,
  },
  { label: "CVC", value: "Any 3 digits, e.g. 123", instruction: true },
  { label: "Name, country, ZIP", value: "Anything", instruction: true },
];

export const ONBOARDING_VALUES: GuideValue[] = [
  {
    label: "Phone",
    value: "Click “Use test phone number”",
    group: "identity",
    instruction: true,
  },
  { label: "SMS code", value: "000000", copy: "000000", group: "identity" },
  {
    label: "Date of birth",
    value: "01/01/1901",
    copy: "01/01/1901",
    group: "identity",
  },
  {
    label: "SSN",
    value: "000-00-0000",
    copy: "000-00-0000",
    note: "If asked for the last 4 digits, use 0000.",
    group: "identity",
  },
  {
    label: "Address line 1",
    value: "address_full_match",
    copy: "address_full_match",
    note: "Any real US city, state and ZIP.",
    group: "identity",
  },
  {
    label: "Payout bank",
    value: "Choose “Test (Non-OAuth)”",
    note: "Avoid the “Invalid” and “Down” test banks.",
    group: "bank",
    instruction: true,
  },
  {
    label: "Routing number",
    value: "110000000",
    copy: "110000000",
    note: "Only if you enter bank details manually.",
    group: "bank",
  },
  {
    label: "Account number",
    value: "000123456789",
    copy: "000123456789",
    group: "bank",
  },
];

export const TESTING_TIPS: string[] = [
  "This is a Stripe sandbox: no real money moves.",
  "Checkout may show your local currency. Choosing USD keeps amounts simple; either works.",
  "Stripe may also offer Bank or Klarna through Link. Use Card when testing.",
  "A second payment for an item that's already sold is refunded automatically.",
];
