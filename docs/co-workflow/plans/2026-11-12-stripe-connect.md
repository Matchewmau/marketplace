# Stripe Connect plan: D:\CODE\marketplace (branch `stripe-integration`)

**Status:** Revision 2, approved 2026-11-12. The user chose **Option I (typed email, locked on first onboarding)**, so Unit 4b and the OTP UI are not built. Tier 3 (payments).

**Sandbox probe (2026-11-12):** the key is `sk_test`, and the platform is a US account with currency USD. `GET /v2/core/accounts` returns `non_connect_platform_accounts_v2_access_blocked`: Connect is not yet enabled on this sandbox. Re-probe before Unit 5. If v2 is still blocked after Connect is enabled, use the v1 `controller` fallback.

**Source spec:** the Notion page "Test 4: Stripe Connect". In sandbox mode, sellers onboard through Stripe Connect, their listings get a Buy Now button, and buyers pay through the Stripe SDK.

## Goal
In the Stripe sandbox:
- Sellers onboard through Stripe Connect.
- Buyers pay for a listing through hosted Checkout, using a destination charge to the seller.
- Each payment is fulfilled once by a shared, idempotent `fulfillCheckoutSession`. Both the signed webhook and the success page call it.
- Fulfilment writes a Supabase `orders` row and marks the listing sold.

## Decisions awaiting the user (default in brackets)
1. **Seller identity** [I: typed email, locked on first onboarding].
   - **I. Typed email, locked on first onboarding.** This keeps the app's current trust model (README "Known limitations": "anyone who knows a seller email can view that inbox").
     - The first onboarding for an email binds it to one Stripe account.
     - A "continue onboarding" link is issued only while `details_submitted` is false. After that, the email can only read its status.
     - A reviewer can run the whole flow with no extra setup.
     - The hijack risk is documented as sandbox-only and not production-safe.
   - **II. Supabase Auth email OTP.** The server reads the email from a verified JWT. This is secure, but Supabase's built-in SMTP only delivers to project team members, at about 2 emails per hour. Custom SMTP (for example Resend) is therefore required before a reviewer can onboard. Choosing II adds Unit 4b and swaps the Unit 6 UI (both described below).
2. **Platform fee** [`PLATFORM_FEE_BPS=0`, configurable from 0 to 10000].
3. **Applying the migration** [the user runs it in the Supabase SQL editor]. I can also apply it through the connected Supabase tool if asked.

## Decisions taken
| Decision | Chosen | Rejected |
|---|---|---|
| Connected accounts | Accounts v2, `dashboard:'express'`, recipient configuration `stripe_balance.stripe_transfers.requested:true`, `defaults.responsibilities.{fees_collector,losses_collector}:'application'` (docs.stripe.com/connect/marketplace/tasks/create). Fallback: v1 `accounts.create` with `controller`, confined to `connect.ts`. | v1 `type:'express'` (legacy) |
| Onboarding | Stripe-hosted v2 Account Links | Embedded components |
| Charge type | Destination charge, plus `application_fee_amount` when the fee is above 0 | Direct charges; separate charges and transfers |
| Payment UI | Hosted Checkout | Embedded Checkout or Elements. These need the publishable key, so **the publishable key is not used**. |
| Fulfilment | Shared `fulfillCheckoutSession`, called from the webhook **and** the success page (Stripe's recommended pattern). The demo then works even without the CLI. | Webhook only |
| Double purchase | An atomic `listing_holds` row via an SQL function before the session is created. `record_paid_order` row-locks the listing. A paid session for a listing that is already sold becomes `refund_pending`, and is refunded with `reverse_transfer`. Refunds are retried until they succeed. | A check in the webhook only |

## Foundation (checked this session)
- `npx tsc --noEmit` exits 0.
- `npm run lint` shows 0 errors and 1 warning that was already there.
- There are no tests and no CI.
- Node is v20.17.0, so pin `vitest@4.1.12` and `vite@6.4.6`. CI runs on Node 22.
- `stripe@23.1.0` pins API version `2026-10-28.endive` (the critic verified both).
- Account Link URLs require HTTPS locally. Use a `dev:https` script.
- Supabase grants EXECUTE on public functions to anon, so the migration must revoke it.

## Work units
Run everything from `D:\CODE\marketplace`. Each unit commits only when `npm run check` passes.

### Unit 0: Test foundation (mechanical)
- Run `npm i -D vitest@4.1.12 vite@6.4.6`.
- Create `vitest.config.mts` with `environment:'node'`, `include:['src/**/*.test.ts']` and `resolve.alias {'@': path.resolve(__dirname,'src')}`.
- Add these scripts to `package.json`:
  - `"test":"vitest run"`
  - `"test:watch":"vitest"`
  - `"check":"tsc --noEmit && eslint && vitest run"`
  - `"dev:https":"next dev --turbopack --experimental-https"`
- Create `src/lib/format.test.ts` with 3 tests:
  - `formatPrice(0)==="Free"`
  - `formatPrice(19.5)==="$19.50"`
  - `formatPrice("12")==="$12"`
- Create `src/lib/validation.test.ts` with 4 tests:
  - `isUuid` accepts a v4 UUID.
  - `isUuid` rejects `"abc"`.
  - `isValidEmail("a@b.co")` returns true.
  - `isValidEmail("nope")` returns false.
- Create `.github/workflows/ci.yml`: Node 22, `npm ci`, `npm run check`, `npm run build`.
- Expected: `npm test` shows 7 passing tests, and `npm run check` exits 0.

### Unit 1: Stripe config, client and amounts (mechanical; needs Unit 0)
- Run `npm i stripe@23.1.0`.
- `src/lib/stripe/config.ts`:
```ts
export class StripeConfigError extends Error {}
export function assertSandboxSecretKey(key: string | undefined): string; // throws unless /^(sk|rk)_test_/
export type StripeEnv = { secretKey: string; webhookSecret: string | null; platformFeeBps: number; appUrl: string | null };
export function readStripeEnv(env?: NodeJS.ProcessEnv): StripeEnv; // PLATFORM_FEE_BPS int 0..10000, default 0, else throw
```
- `src/lib/stripe/server.ts`:
  - Start with the same browser guard as `supabase-admin.ts:4`.
  - `export function getStripe(): Stripe` is a lazy singleton: `new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, appInfo: { name: "marketplace" } })`.
  - `export const STRIPE_API_VERSION` is the installed value, found with `grep -o "'[0-9-]*\.[a-z]*'" node_modules/stripe/cjs/apiVersion.js`.
  - `export function getAppOrigin(request: Request): string` returns `APP_URL` when it is set, otherwise the request origin.
- `src/lib/stripe/amount.ts`:
```ts
export const STRIPE_MIN_CHARGE_CENTS = 50;
export const STRIPE_MAX_CHARGE_CENTS = 99_999_999;
export function dollarsToCents(value: number | string): number | null; // number→toFixed(2); /^(\d+)(?:\.(\d{1,2}))?$/; integer math only
export function applicationFeeCents(amountCents: number, bps: number): number; // Math.floor(amountCents*bps/10000)
export function safeProductImage(url: string | null): string[] | undefined; // [url] only if https: and length <= 2048
```
- Write the tests first.
  - `config.test.ts` (6 tests):
    - `sk_live_` throws.
    - `pk_test_` throws.
    - `sk_test_x` is accepted.
    - `rk_test_x` is accepted.
    - A missing key throws.
    - `PLATFORM_FEE_BPS="abc"` throws.
  - `amount.test.ts` (11 tests):
    - `"19.99"` gives 1999.
    - `19.99` gives 1999.
    - `0.1+0.2` gives 30.
    - `"10"` gives 1000.
    - `"1.234"` gives null.
    - `-1` gives null.
    - `1e21` gives null.
    - `applicationFeeCents(1000, 250)` gives 25.
    - `safeProductImage("http://x")` gives undefined.
    - `safeProductImage("https://x/y.jpg")` gives `["https://x/y.jpg"]`.
    - `safeProductImage(null)` gives undefined.
- Run `npx vitest run src/lib/stripe`: 17 tests fail, then pass after implementation.
- Add to `.env.local.example`:
  - `STRIPE_SECRET_KEY=sk_test_replace_me`
  - `STRIPE_WEBHOOK_SECRET=whsec_replace_me`
  - `PLATFORM_FEE_BPS=0`
  - `APP_URL=https://localhost:3000`, with a comment: local only; leave it unset on Vercel, or set it to the production URL.

### Unit 2: Migration, types and SQL checks (judgment; needs Unit 0)
Create `supabase/migrations/20261112000000_stripe_connect.sql`. Add two columns to `listings`:
```sql
alter table public.listings
  add column if not exists status text not null default 'active' check (status in ('active','sold')),
  add column if not exists sold_at timestamptz;
```

Create these tables. RLS is enabled on each, with no policies.
- **`seller_accounts`:**
  - `seller_email varchar(255) primary key check (seller_email = lower(seller_email))`
  - `stripe_account_id text not null unique`
  - `charges_enabled`, `payouts_enabled`, `details_submitted`: `boolean not null default false`
  - `created_at`, `updated_at`: `timestamptz not null default now()`
  - The `update_updated_at_column` trigger.
  - (Option II also adds `auth_user_id uuid references auth.users(id) on delete cascade`.)
- **`listing_holds`:**
  - `listing_id uuid primary key references listings(id) on delete cascade`
  - `hold_token uuid not null`
  - `checkout_session_id text`
  - `checkout_url text`
  - `expires_at timestamptz not null`
  - `created_at timestamptz not null default now()`
- **`orders`:**
  - `id uuid pk default gen_random_uuid()`
  - `listing_id uuid not null references listings(id) on delete restrict`
  - `stripe_checkout_session_id text not null unique`
  - `stripe_payment_intent_id text`
  - `stripe_refund_id text`
  - `seller_email varchar(255) not null`
  - `seller_stripe_account_id text not null`
  - `buyer_email varchar(255)`
  - `amount_cents integer not null check (amount_cents >= 50)`
  - `application_fee_cents integer not null default 0 check (application_fee_cents >= 0)`
  - `currency char(3) not null default 'usd'`
  - `status text not null check (status in ('paid','refund_pending','refunded'))`
  - `created_at`, `updated_at`
  - Index: `create unique index orders_one_paid_per_listing on orders(listing_id) where status='paid'`.

**Functions** (plpgsql, `security invoker`):
- **`reserve_listing(p_listing_id uuid, p_hold_token uuid, p_ttl_seconds int) returns boolean`:**
  1. Select the listing where `status='active'` with `for update`. If no row is found, return false.
  2. Insert the hold with `on conflict (listing_id) do update set hold_token=excluded.hold_token, expires_at=excluded.expires_at, checkout_session_id=null, checkout_url=null where listing_holds.expires_at < now()`.
  3. Return `found`.
- **`attach_hold_session(p_listing_id uuid, p_hold_token uuid, p_session_id text, p_url text) returns void`:** updates the hold where both the listing id and the token match.
- **`release_listing_hold(p_listing_id uuid, p_hold_token uuid) returns void`:** deletes the hold where both values match.
- **`record_paid_order(p_session_id text, p_payment_intent_id text, p_listing_id uuid, p_buyer_email text, p_amount_cents int, p_fee_cents int, p_seller_account_id text) returns text`:**
  1. Lock the listing row (`for update`). Raise an error if it is missing.
  2. If an order exists for `p_session_id`, return `'duplicate'` when its status is `paid` or `refunded`, and `'refund_pending'` when it is `refund_pending`.
  3. If the listing is already `sold`, insert the order as `refund_pending` and return `'refund_pending'`.
  4. Otherwise insert the order as `paid`, set the listing to `sold` with `sold_at=now()`, delete the hold, and return `'recorded'`.

  `seller_email` is always copied from the listing.
- **`mark_order_refunded(p_session_id text, p_refund_id text) returns void`.**
- **Grants:** for every function, `revoke all … from public, anon, authenticated; grant execute … to service_role;`.

**SQL checks:** create `supabase/tests/stripe_connect_checks.sql`. It runs in the SQL editor inside `begin; … rollback;` and raises an exception on any failure. It covers:
- The first reserve returns true and a second reserve with a different token returns false.
- After the hold expires, reserve returns true again.
- `record_paid_order` returns `recorded`, then `duplicate` for the same session.
- A second session for the sold listing returns `refund_pending`.
- `orders_one_paid_per_listing` holds.
- `has_function_privilege('anon','public.reserve_listing(uuid,uuid,int)','execute')` is false.

**`src/lib/types.ts`:**
- Add to `Listing`: `status: "active" | "sold"` and `sold_at: string | null`.
- `SellerPaymentStatus = { stripe_account_id: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }`
- `PurchaseBlockReason = "free"|"below_minimum"|"above_maximum"|"sold"|"reserved"|"seller_not_onboarded"|"payments_unavailable"`
- `PurchaseState = { buyable: true; amountCents: number } | { buyable: false; reason: PurchaseBlockReason }`

**Accept when:**
- tsc passes.
- The SQL checklist is satisfied: RLS on all 3 tables, 0 policies, revokes present.
- The check script prints `ALL CHECKS PASSED` once the user applies the migration.

### Unit 3: Purchase eligibility (mechanical; needs Units 1 and 2)
`src/lib/purchase.ts`:
```ts
export type SellerGate = Pick<SellerPaymentStatus, "charges_enabled"> | null;
export function getPurchaseState(listing: Pick<Listing,"price"|"status">, seller: SellerGate, hasActiveHold: boolean, paymentsConfigured: boolean): PurchaseState;
export const PURCHASE_REASON_TEXT: Record<PurchaseBlockReason, string>;
```
- Reasons are checked in this order: sold, free, below_minimum, above_maximum, payments_unavailable, seller_not_onboarded, reserved.
- `purchase.test.ts` has 8 tests: one for each reason, plus a buyable listing at `19.99` giving `amountCents` 1999.
- Run `npx vitest run src/lib/purchase.test.ts`: 8 tests fail, then pass.

### Unit 4: Seller claim rule (integration; needs Units 0 and 2). This is Option I.
`src/lib/seller-claim.ts`:
```ts
export type OnboardDecision = { action: "create" } | { action: "link"; accountId: string } | { action: "status_only"; accountId: string };
export function decideOnboarding(row: { stripe_account_id: string; details_submitted: boolean } | null): OnboardDecision;
export function normalizeSellerEmail(input: unknown): string | null; // trim, lowercase, isValidEmail
```
- `decideOnboarding` behaves as follows:
  - With no row, it returns `create`.
  - With `details_submitted` false, it returns `link`.
  - Otherwise it returns `status_only`.
- `seller-claim.test.ts` has 5 tests: `create`, `link`, `status_only`, `normalize(" A@B.Co ")` gives `"a@b.co"`, and `normalize("x")` gives null.

**Unit 4b (Option II only):** `src/lib/seller-auth.ts` exports `getVerifiedSellerEmail(request: Request, admin: SupabaseClient): Promise<{ ok: true; email: string; userId: string } | { ok: false; status: 401; error: string }>`.
- It reads a Bearer JWT and calls `admin.auth.getUser(jwt)`.
- It requires `email` and `email_confirmed_at`, and returns the email lowercased.
- 4 tests: no header gives 401, getUser error gives 401, an unconfirmed email gives 401, and a valid user returns the lowercased email.

### Unit 5: Connect library and routes (integration; needs Units 1, 2 and 4)
`src/lib/stripe/connect.ts`:
```ts
export function normalizeAccountStatus(a: Stripe.V2.Core.Account): Omit<SellerPaymentStatus,"stripe_account_id">;
export async function createSellerAccount(stripe: Stripe, email: string): Promise<string>;
export async function createOnboardingLink(stripe: Stripe, accountId: string, origin: string): Promise<string>;
export async function refreshSellerAccount(stripe: Stripe, admin: SupabaseClient, email: string): Promise<SellerPaymentStatus | null>;
```
- **`normalizeAccountStatus`:**
  - `charges_enabled` = `configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active"`.
  - `details_submitted` = no entry in `requirements.entries` has `minimum_deadline.status` of `currently_due` or `past_due`.
  - `payouts_enabled` = `payouts?.status === "active"` when that field is present at runtime, otherwise `charges_enabled && details_submitted`. The type is at `node_modules/stripe/cjs/resources/V2/Core/Accounts.d.ts`.
- **`createSellerAccount`:** sends the marketplace guide's parameters plus:
  - `contact_email`
  - `display_name: email`
  - `identity.country:"us"`
  - `metadata.seller_email`
  - `include:["configuration.recipient","requirements"]`
- **`createOnboardingLink`:** sends `use_case:{type:"account_onboarding", account_onboarding:{return_url:`${origin}/seller/payments?onboarding=return`, refresh_url:`${origin}/seller/payments?onboarding=refresh`}}`.
  - Do **not** pass `configurations`; stripe-node 23 removed it.
  - Confirm the shape against the installed `AccountLinkCreateParams`.
- **`refreshSellerAccount`:** retrieves the account with the same `include` and updates the row.
- **`POST /api/stripe/connect/onboard`:**
  - Body: `{ email }` under Option I. Under Option II, a Bearer JWT instead.
  - Responses:
    - `400` for an invalid email.
    - `503` when Stripe or the admin client isn't configured.
    - Otherwise `{ url }` for `create` or `link`, or `{ status }` for `status_only`.
  - On `create`, insert the row. On a primary-key conflict, re-select and apply `decideOnboarding` again.
- **`GET /api/stripe/connect/status?email=`** returns `{ status: SellerPaymentStatus|null }` after refreshing.
- **Tests:**
  - `connect.test.ts` (5 tests):
    - Active with no requirements gives all flags true.
    - Pending gives charges false.
    - `past_due` gives details false.
    - Missing configuration gives all false.
    - No `payouts` field falls back to `charges && details`.
  - `onboard/route.test.ts` (4 tests, using `vi.mock` for admin and Stripe):
    - An invalid email gives 400.
    - A new email calls `create` once and returns `url`.
    - An incomplete existing account returns a link with no `create` call.
    - A completed account returns `status` with no link call.

### Unit 6: Seller payouts UI (integration; needs Unit 5)
- `src/app/seller/payments/page.tsx` renders `<SellerPaymentsPanel/>` from `src/components/marketplace/seller-payments-panel.tsx` (`"use client"`).
- Option I panel:
  - An email field, prefilled from `localStorage` `marketplace_seller_email`.
  - A "Check status" action that calls GET status.
  - A "Set up payouts with Stripe" or "Continue onboarding" button that POSTs onboard and then sets `window.location.href = url`.
  - Status flags with text labels.
  - A sandbox notice: "Demo only: payouts are keyed by email, not a login."
- `?onboarding=return` re-fetches the status. `?onboarding=refresh` POSTs onboard again.
- Option II panel: replace the email field with the OTP steps `signInWithOtp` followed by `verifyOtp({type:"email"})`, and send `Authorization: Bearer`.
- Add a "Get paid" link in `header.tsx`, next to `/your-listings`, and a CTA on `your-listings/page.tsx`.
- Accept when a manual onboarding run works and `npm run check` is green.

### Unit 7: Listing purchase state and Buy Now (integration; needs Units 3 and 5)
- `src/app/api/listings/[id]/route.ts`:
  - Use `getSupabaseAdmin()` to read the `seller_accounts` row for `lower(seller_email)` and any `listing_holds` row with `expires_at > now()`.
  - Return `{ listing, purchase: PurchaseState }`.
  - Set `paymentsConfigured=false` when the admin client or Stripe env is missing.
- `src/components/marketplace/buy-now-button.tsx`, `BuyNowButton({ listingId, purchase }: { listingId: string; purchase: PurchaseState })`:
  - **When buyable:**
    - POST `/api/checkout` with `{ listingId, holdToken }`. `holdToken` comes from `sessionStorage['hold:'+listingId]`, if present.
    - Store the returned `holdToken`, then redirect.
    - Disable the button while the request is pending.
    - Show errors inline with `role="alert"`.
  - **When not buyable:** show a disabled button with `PURCHASE_REASON_TEXT`. For the `free` reason, render nothing.
- In `listing-detail.tsx`, render the button under the price.
- In `item-card.tsx`, show a "Sold" badge.
- `route.test.ts` has 3 tests: an onboarded seller gives `buyable`, no seller row gives `seller_not_onboarded`, and a sold listing gives `sold`.

### Unit 8: Checkout, fulfilment and buyer pages (judgment; needs Units 2, 3 and 5)
`src/lib/checkout.ts`:
```ts
export const CHECKOUT_SESSION_TTL_SECONDS = 1860; export const HOLD_TTL_SECONDS = 2400;
export type CheckoutResult = { ok: true; url: string; holdToken: string } | { ok: false; status: 400|404|409|502|503; error: string; reason?: PurchaseBlockReason };
export async function createCheckoutForListing(listingId: string, origin: string, deps: { stripe: Stripe; admin: SupabaseClient; feeBps: number; holdToken?: string }): Promise<CheckoutResult>;
export async function cancelCheckoutHold(listingId: string, holdToken: string, deps: { stripe: Stripe; admin: SupabaseClient }): Promise<void>;
```
`createCheckoutForListing` runs these steps in order:
1. Read the price from the database through the admin client, then call `getPurchaseState(hasActiveHold=false)`.
2. If `holdToken` matches an unexpired hold whose `checkout_url` is set, return that URL. This handles the browser Back button.
3. Call `refreshSellerAccount` live. If the seller can't take charges, return 409 `seller_not_onboarded`.
4. Call `reserve_listing` with a new `crypto.randomUUID()`. If it returns false, return 409 `reserved`.
5. Create the session with `{ idempotencyKey: hold }`. If this fails, release the hold and return 502. Session parameters:
   - `mode:"payment"`
   - `payment_method_types:["card"]`
   - `price_data`: `currency:"usd"`, `unit_amount` = cents from the database, `product_data{name, images: safeProductImage(image_url)}`
   - `payment_intent_data`: `transfer_data{destination}`, `application_fee_amount` (only when above 0), `metadata`
   - `metadata{listing_id, hold_token, seller_account_id}`
   - `expires_at = now + 1860s`
   - `success_url:${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url:${origin}/checkout/cancel?listing=${id}&hold=${hold}`
6. Call `attach_hold_session`.

`src/lib/fulfillment.ts`:
```ts
export type FulfillOutcome = "recorded"|"duplicate"|"refunded"|"not_paid";
export async function fulfillCheckoutSession(sessionId: string, deps: { stripe: Stripe; admin: SupabaseClient }): Promise<FulfillOutcome>;
```
1. Retrieve the session with `expand:["payment_intent"]`. If `payment_status!=="paid"`, return `not_paid`.
2. Call `record_paid_order`. It uses `amount_total`, `payment_intent.application_fee_amount ?? 0`, `customer_details.email` and the metadata.
3. If the result is `refund_pending`, refund with `refunds.create({ payment_intent, reverse_transfer:true, refund_application_fee: fee>0 }, { idempotencyKey:`refund_${sessionId}` })`, call `mark_order_refunded`, and return `refunded`.
4. An RPC or refund error throws.

Routes and pages:
- `POST /api/checkout` with `{listingId, holdToken?}` maps directly to `CheckoutResult`.
- `/checkout/cancel` validates the UUIDs, calls `cancelCheckoutHold` (which expires the session if it is open and ignores Stripe errors), and shows "Payment cancelled – you were not charged" with a link back to the listing.
- `/checkout/success`:
  - Requires the `cs_` prefix and calls `fulfillCheckoutSession`.
  - On `recorded` or `duplicate`, it shows the title, the amount and "Order confirmed".
  - On `refunded`, it shows "Item already sold – you've been refunded".
  - On `not_paid`, it shows "Payment processing".

`checkout.test.ts` has 8 tests:
- A free listing gives 409 `free`.
- `unit_amount===1999` comes from the database.
- `reserve` returning false gives 409 `reserved` with no session created.
- A session error releases the hold.
- Fee 500 bps gives `application_fee_amount:99`.
- The destination equals the seller's account.
- `expires_at - now >= 1860`.
- A matching `holdToken` with `checkout_url` returns the existing URL with no `reserve` call.

`fulfillment.test.ts` has 5 tests:
- `recorded`.
- `duplicate` makes no refund call.
- `refund_pending` refunds once with `reverse_transfer` and calls `mark_order_refunded`.
- A second call while still `refund_pending` (because the earlier refund threw) retries the refund.
- An unpaid session returns `not_paid`.

### Unit 9: Webhook (judgment; needs Unit 8)
- `src/lib/stripe/webhook-handler.ts` exports `handleStripeEvent(event: Stripe.Event, deps): Promise<"fulfilled"|"released"|"ignored">`:
  - `checkout.session.completed` and `checkout.session.async_payment_succeeded` call `fulfillCheckoutSession(session.id)`.
  - `checkout.session.expired` calls `release_listing_hold(metadata.listing_id, metadata.hold_token)`.
  - Any other event returns `ignored`.
- `src/app/api/stripe/webhook/route.ts`:
  - `export const runtime = "nodejs"`.
  - Read `await request.text()`, then call `stripe.webhooks.constructEvent(body, sig, webhookSecret)`.
  - Responses:
    - 400 for a bad or missing signature.
    - 503 when the route isn't configured.
    - 500 when the handler throws, so Stripe retries.
    - 200 otherwise.
- `webhook-handler.test.ts` has 3 tests:
  - `completed` calls fulfil.
  - `expired` releases the hold with the metadata token.
  - An unknown event is ignored.
- `route.test.ts` has 2 tests, signed with `generateTestHeaderString`: a valid signature returns 200, and a tampered body returns 400.

### Unit 10: Docs (mechanical; needs all units)
Update `README.md` with:
- **Stripe section:**
  - The environment variables.
  - The sandbox guard.
  - The flow.
  - The new API rows.
  - "Publishable key not needed".
- **Local HTTPS setup:**
  - Run `npm run dev:https`.
  - Run `stripe listen --forward-to https://localhost:3000/api/stripe/webhook --skip-verify`.
  - Copy the `whsec_` secret.
- **Vercel setup:**
  - Leave `APP_URL` unset, or set it to the production URL.
  - Point the Dashboard webhook at the **production** URL for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`. Preview deployments are behind deployment protection.
- **Stripe test onboarding values.**
- **The schema, plus the SQL check script.**
- **Known limitation:** Option I's email-keyed payouts are not production-safe.

## Requirement → unit
| Requirement | Units |
|---|---|
| Sandbox only, env | 1 |
| Seller onboarding and status | 2, 4, 5, 6 |
| Buy Now gating | 3, 7 |
| Price integrity | 1, 8 |
| Fulfilment, idempotency, race, refunds | 2, 8, 9 |
| Success and cancel pages | 8 |
| Identity | 4 (or 4b), 5, 6 |
| Migration and RLS | 2 |
| Docs (CLI, Vercel) | 10 |
| No regressions | 0, 7, `check`, E2E step 10 |

## Critic issues and how each was handled
| # | Issue | Disposition |
|---|---|---|
| 1 | `configurations` removed from v2 AccountLink params in stripe-node 23 | Accepted. Removed in Unit 5; the implementer confirms against the installed types. |
| 2 | OTP is unusable for a reviewer because of SMTP limits | Accepted. Option I is now the default, and II is kept with custom SMTP. This is the user's decision. |
| 3 | `expires_at` of exactly 30 min can be rejected | Accepted. Changed to 1860 s, with a 2400 s hold and a test. |
| 4 | Refund not retried after a failure | Accepted. `refund_pending` now triggers a retry, covered by a test. |
| 5 | Orders depend on `stripe listen` | Accepted. The success page also calls `fulfillCheckoutSession`. |
| 6 | Browser Back locks the listing for 35 min | Accepted with a change: the open session is reused only when the buyer's own `holdToken` matches, so another buyer never gets that URL. |
| 7 | `payouts_enabled` fallback used the wrong path | Accepted. Decided at runtime; path corrected. |
| 8 | Non-https images break Checkout | Accepted. Added `safeProductImage`. |
| 9 | SQL functions untested | Accepted. Added `supabase/tests/stripe_connect_checks.sql`. |
| 10 | APP_URL on Vercel and preview protection | Accepted. Documented in Unit 10. |

## Risks
- **Option I hijack.** Someone could claim an email that hasn't been onboarded yet. This is documented and sandbox-only.
- **Accounts v2 not enabled on the sandbox.** Fall back to v1 `controller` inside `connect.ts`.
- **HTTPS requirement for Account Links in test mode (not verified).** The `dev:https` script covers it either way.
- **Migration rollback.** The migration only adds things, so rolling back means dropping the functions and tables, then the 2 new `listings` columns.

## Manual user steps
1. Put `STRIPE_SECRET_KEY` (`sk_test_…`) and `STRIPE_WEBHOOK_SECRET` into `.env.local`.
2. In the Stripe Dashboard (sandbox), enable Connect as a marketplace and accept platform-managed losses.
3. Apply the migration, then run the SQL check script.
4. Install the Stripe CLI and run `stripe login`.
5. When deploying: set the Vercel env vars and create the Dashboard webhook.
6. (Option II only) Configure custom SMTP in Supabase Auth.

## Verification
Run:
```
npm run check && npm run build
```
Then the end-to-end flow:
1. Create a $25 listing. The item shows the disabled state "Seller hasn't set up payments".
2. Onboard the seller at `/seller/payments`. Test values: phone 000-000-0000, SMS code 000000, SSN 000-00-0000, bank 110000000 / 000123456789. All flags turn true.
3. Use Buy Now and pay with card 4242 4242 4242 4242.
4. `/checkout/success` shows "Order confirmed", and the listing is `sold`.
5. Supabase has exactly 1 `paid` order with `amount_cents=2500`, and Stripe shows the transfer.
6. With `stripe listen` running, the webhook returns 200, and `stripe events resend` still leaves 1 order.
7. With two browsers, the second gets 409 `reserved`.
8. Pressing browser Back from Checkout and then Buy Now again reuses the session.
9. Cancelling releases the hold.
10. Regression: create, browse, message and inbox all still work.

## Out of scope
Refund UI, carts, shipping and tax, live mode, embedded onboarding, v2 event destinations.
