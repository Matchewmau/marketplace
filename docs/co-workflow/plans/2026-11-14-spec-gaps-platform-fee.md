# Plan: Close the Test 4 spec gaps (platform fee, sandbox keys, wording, screenshots)

**Status:** revision 3. Branch `stripe-integration`, which is Vercel's production branch, so a push deploys to production.

## Progress (2026-11-14)
- **Fee 10%:** confirmed by the user.
- **Units 1–3 committed and reviewed (APPROVE), not pushed:**
  - `e6e8727` fee default
  - `626d1ac` fee notice
  - `361da86` wording
  - `45ca318` seed comment wording
- **Webhook script committed:** `ab81c33`, reviewed, with its fix `d8ed98e` (create-before-delete) also reviewed.
- The user already set the provided keys in Vercel and in `.env.local`. Production is **not** redeployed yet: it still answers with the old account.
- **R1 probe:**
  - The provided platform is `acct_1UbRi2…`, country EE (EEA→US transfers are supported per Stripe docs).
  - It has 0 webhook endpoints.
  - v2 account reads work.
  - Old seller accounts return `forbidden`, not `resource_missing`, so they never auto-unbind.
- **R3:** 0 active holds.
- **Stale rows:** there are **5** `seller_accounts` rows: mathewmau22, mathewmau, 3mathewmau, jazz, and wayne@gmail.com (created 2026-11-13 21:06 via production, incomplete). All are on the old platform.
- **Next:**
  1. The user runs `node --env-file=.env.local scripts/create-webhook.mjs` and puts the secret in Vercel.
  2. R2 test account create, link and close (needs approval).
  3. Export and delete the 5 rows (needs approval).
  4. Push (needs approval).
  5. Re-onboard and buy (user).

## Goal
Make the live app meet the Notion Test 4 spec:
- a 10% platform fee
- running on the provided sandbox keys
- the spec's button wording
- the four submission screenshots

## Spec gaps found
| Spec item | Today | Unit |
|---|---|---|
| "marketplace keeps a small platform fee (for example 10%)" | Built but `PLATFORM_FEE_BPS` defaults to 0 and is unset on Vercel, so every order has fee 0 | 1, 2 |
| "Use the Stripe sandbox keys we provide" | App runs on the user's own sandbox | 4 |
| "Connect with Stripe" / "Buy Now" | "Set up payouts with Stripe" / "Buy now" | 3 |
| Screenshots: onboarding, checkout, success page, order in Supabase | None for Test 4 | 5 |

Already compliant: the account ID is saved; non-onboarded sellers can't be bought from; destination charges; the webhook confirms and marks Sold; orders are recorded; the success page exists.

## Decisions
1. **Fee source:** a code default of 1000 bps. The env var still overrides it, and `0` is allowed.
   - Rejected: env-only. The variable was never set on Vercel, which is today's bug, and local and preview would drift.
2. **Fee disclosure:** the server page reads the fee and passes `platformFeeBps` to the panel, which shows one line on Get paid.
   - Rejected: a status-API field, because it changes the contract and only shows after an email lookup.
   - Rejected: the testing guide, because it's static and would drift.
   - Rejected: the success page, because buyers don't pay the fee.
3. **Order:** Units 1–3 ship and are live first, then the key switch. One purchase (R7) then proves both the fee and the switch, and the old env values stay as a tested rollback.
4. **Critic issue rejected:** separating fee parsing from the webhook route. A bad `PLATFORM_FEE_BPS` already hides the Get paid fee line, and Gate G1 checks that line before the switch.

## Work units

### Unit 1: Fee default 1000 (mechanical)
- **Files:** `src/lib/stripe/config.ts:23-37`, `src/lib/stripe/config.test.ts:66-76`.
- **New exports:**
  ```ts
  export const DEFAULT_PLATFORM_FEE_BPS = 1000;
  /** PLATFORM_FEE_BPS as an int 0..10000; DEFAULT_PLATFORM_FEE_BPS when unset/empty; throws StripeConfigError otherwise. Needs no secret key. */
  export function readPlatformFeeBps(env: NodeJS.ProcessEnv = process.env): number;
  ```
  `readStripeEnv` uses `readPlatformFeeBps(env)`.
- **Tests first:**
  - the defaults test expects `platformFeeBps: 1000`
  - `readPlatformFeeBps({PLATFORM_FEE_BPS:"0"})` returns 0
  - `readPlatformFeeBps({})` returns 1000
- **Commands:** `npx vitest run src/lib/stripe/config.test.ts` should fail, then pass after implementing. Then `npm run check` should pass.
- **Accept:** unset or empty gives 1000; `"0"` gives 0; `"abc"` and `"10001"` still throw.
- **Commit:** `feat: default platform fee to 10%`

### Unit 2: Fee disclosure (integration; after Unit 1)
- **Create:** `src/lib/platform-fee.ts` and `src/lib/platform-fee.test.ts`:
  ```ts
  /** 1000→"10%", 250→"2.5%", 1→"0.01%", 10000→"100%" */
  export function formatFeePercent(bps: number): string;
  /** null when bps<=0, else "The marketplace keeps a 10% platform fee on each sale; the rest goes to your Stripe account." */
  export function platformFeeNotice(bps: number): string | null;
  ```
- **Modify:**
  - `src/app/seller/payments/page.tsx`: call `readPlatformFeeBps()` in try/catch, passing `null` on `StripeConfigError`.
  - `seller-payments-panel.tsx`: takes the prop `{ platformFeeBps: number | null }` and renders the notice as `<p className="text-xs text-gray-500">` in the footer, above "Demo only".
  - `README.md:83,100,327` and `.env.local.example:8`: change to `PLATFORM_FEE_BPS=1000`. Add a README row for `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: set per the assignment, unused because Checkout is a hosted redirect.
- **Commands:** `npx vitest run src/lib/platform-fee.test.ts` should fail, then pass. Then `npm run check` should pass.
- **Accept:** Get paid shows the 10% line in every state, and no line when the env var is `0`.
- **Commit:** `feat: show platform fee on Get paid`

### Unit 3: Spec wording (mechanical)
- **Files:**
  - `src/components/marketplace/buy-now-button.tsx:50,131`: "Buy Now".
  - `seller-payments-panel.tsx:387`: "Buy Now".
  - `seller-payments-panel.tsx:490`: "Connect with Stripe" (keep "Continue setup").
  - `src/lib/testing-guide.ts:16-17`: "Buy Now", and "set up payouts" → "click Connect with Stripe".
  - `README.md:35,201,204,209`: the same wording.
- **Tests first:** add `toContain("Buy Now")` and `toContain("Connect with Stripe")` on `QUICK_START.join(" ")` in `src/lib/testing-guide.test.ts`. It should fail, then pass. Then `npm run check` should pass.
- **Accept:** `grep -rn "Buy now\|Set up payouts with Stripe" src README.md` returns nothing.
- **Commit:** `fix: match spec button wording`

### Gate G1 (user approves the push)
- Push Units 1–3; Vercel deploys production from `stripe-integration`.
- Pass when production Get paid shows the 10% line and CI is green.

### Unit 4: Switch to the provided sandbox keys (judgment, gated runbook)
**[U]** = the user does it. **[A]** = an agent does it, only after explicit approval. No key or `whsec` value ever appears in chat, the repo, or script output.

- **R1 [A] Read-only probe.** A scratchpad script, run with the provided key from the user's shell as `PROBE_KEY`. It prints only IDs, counts and error codes. It runs:
  - `GET /v1/account`
  - `v2.core.accounts.list({limit:1})`
  - `webhookEndpoints.list({limit:100})` count. **Gate:** fewer than 16, or there's no room for our endpoint.
  - `v2.core.accounts.retrieve(<one stored seller id>)` error code (`resource_missing` or something else)
- **R2 [A] v2 feasibility.**
  - Create one account with the exact `createSellerAccount` payload (`connect.ts:74-89`), plus an onboarding Account Link.
  - **PASS:** both calls return IDs. Don't complete onboarding, so no orphan account is left.
  - **FAIL:** `non_connect_platform_accounts_v2_access_blocked`, a losses-collector or liability error, or any permission error. On FAIL, stop: stay on the own sandbox and note it in the submission.
- **R3 [A] Drain holds.** `select count(*) from listing_holds where expires_at > now()` must return 0. Wait if it doesn't.
- **R4 [U] Vercel Production env.** Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the provided keys. Save the old values for rollback. Don't redeploy yet.
- **R5 [U runs] Webhook endpoint.**
  - The user runs a script against the provided account that creates the endpoint:
    - URL: `https://marketplace-ten-silk-78.vercel.app/api/stripe/webhook`
    - events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`
    - `api_version: 2026-10-28.endive`
  - The script pipes the secret straight to `vercel env add STRIPE_WEBHOOK_SECRET production`, or writes it to a git-ignored file the user copies into Vercel.
- **R6 [U approves the exact SQL] Stale rows.**
  - Export the 4 `seller_accounts` rows, then delete them, immediately **before** the redeploy.
  - The old deployment then shows those sellers as not set up, which is a clean block instead of a 409/502.
  - Listings stay. Keep the old order.
- **R7 [U] Redeploy, re-onboard, buy.**
  1. Re-onboard at least one seller email from the seeded listings with Connect with Stripe.
  2. Buy one of that seller's listings with card 4242 in a private window.
  3. Check:
     - the success page shows
     - the new `orders` row has `application_fee_cents = floor(amount_cents * 0.10)`
     - the listing is `sold`
     - the webhook delivery returned 200
- **Rollback:** restore the old env values, re-insert the exported rows, and redeploy.

### Unit 5: Screenshots (user)
- **[U]** First re-check that our endpoint and the seller account still exist (other candidates share the account).
- Save these to `docs/screenshots/test4/`:
  - `01-seller-onboarding.png`
  - `02-buy-now-checkout.png`
  - `03-success.png`
  - `04-supabase-order.png`, with the fee column visible
- An agent commits them as `docs: add Test 4 screenshots`.

## Risks
- **Shared account:** other candidates' events reach our endpoint. They're ignored by the `app_scope` check (`fulfillment.ts:82`). Others could also delete our endpoint or connected accounts. The success page also records the order (`checkout/success/page.tsx:94`), so a lost endpoint doesn't lose orders.
- **Webhook limit:** the account allows 16 endpoints, checked in R1.
- **Unverified:** whether the provided account allows Accounts v2 (R2), which error a foreign account ID returns (R1), and the Adaptive Pricing currency behaviour (R7 checks the recorded fee).

## Verification
- `npm run check`
- `grep -rn "Buy now\|Set up payouts with Stripe" src README.md` returns nothing.
- G1: the production fee line.
- R7: the purchase checks.

## Out of scope
- A v1 Express fallback, which would be a separate plan if R2 fails.
- Showing the fee on the success page.
- Removing the old order.
