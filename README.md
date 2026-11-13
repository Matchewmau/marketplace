# Marketplace

A Facebook Marketplace–inspired buying and selling app built for the Notion
“Test 3: Marketplace” challenge, and it now also covers “Test 4: Stripe Connect”
(sellers get paid through Stripe, buyers pay with Stripe-hosted Checkout). Visitors can create a listing with a photo,
browse and search listings, filter by category, price, condition, location, and
sort order, open a listing, and send a message to the seller. Sellers read those
messages in an email-keyed inbox. Sellers can set up payouts with Stripe
Connect, and buyers can buy a listing with a card. The Stripe integration runs
in a Stripe **sandbox** only.

**Live demo:** [marketplace-ten-silk-78.vercel.app](https://marketplace-ten-silk-78.vercel.app)

## Features

- Create a listing with a photo, title, price, description, category,
  condition, seller email, and location. Free listings are supported by setting
  the price to `0`.
- Live listing preview while creating, with sticky preview on desktop.
- Browser-side image compression (longest edge at most 1600 px, JPEG at ~0.82
  quality) before upload to Supabase Storage.
- Browse “Today’s picks” in a responsive, Facebook-style grid.
- Search title and description, and filter by category, condition, location,
  minimum price, and maximum price.
- Sort by newest, price low to high, or price high to low.
- 19 category pages at `/category/[slug]`.
- Listing detail page with image, price, condition, category, description,
  seller email, and a message form.
- Message seller flow that stores messages in Supabase. No email is sent.
- Seller inbox at `/messages`, opened from the header message icon, grouped by
  listing with buyer email links and relative timestamps.
- “Your listings” view scoped to the email saved in this browser.
- Seller payouts with Stripe Connect: sellers onboard at `/seller/payments`
  (“Get paid” in the header) using their seller email.
- “Buy Now” on listing pages, with a clear reason when it is disabled (seller
  not set up, free item, below $0.50 or above the online limit, sold, or
  reserved by another buyer).
- Stripe-hosted Checkout using destination charges: the payment goes to the
  seller's connected account, minus an optional platform fee.
- Orders are recorded in Supabase; sold listings show a “Sold” badge.
- Double-purchase protection: starting checkout places a time-limited hold on
  the listing, and if a second payment still lands on an already-sold item it
  is refunded automatically.
- Loading skeletons, empty states, error retry, and a custom not-found page.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15.5.29 (App Router, Turbopack) |
| UI | React 19.1.0, Tailwind CSS 3.4, shadcn/ui, lucide-react |
| Language | TypeScript 5 |
| Database | Supabase Postgres |
| Storage | Supabase Storage (`listing-images` bucket) |
| Payments | Stripe (stripe-node 23.1.0, Connect Accounts v2 recipient accounts, Checkout) |
| Testing | Vitest + PGlite |
| Hosting | Vercel |

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your Supabase keys:

```bash
cp .env.local.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe (sandbox only)
STRIPE_SECRET_KEY=sk_test_replace_me
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_replace_me
PLATFORM_FEE_BPS=1000
APP_URL=https://localhost:3000
```

The publishable/anon key is safe for browser use. `SUPABASE_SERVICE_ROLE_KEY`
is server-only, used by the server routes (messages inbox, Stripe Connect,
checkout, webhook, order fulfillment), and may hold
either the legacy service-role key or the newer `sb_secret_...` key. Never
prefix it with `NEXT_PUBLIC_`, never commit it, and keep `.env.local` out of
git.

Stripe variables:

| Variable | Notes |
| --- | --- |
| `STRIPE_SECRET_KEY` | Sandbox secret or restricted key only (`sk_test_` or `rk_test_`). The server refuses anything else, including live keys. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_…`) for the webhook endpoint. Required by `/api/stripe/webhook`. |
| `PLATFORM_FEE_BPS` | Optional platform fee in basis points, `0`–`10000`. Defaults to `1000` (10%). `0` turns the fee off. The Get paid page shows the fee to sellers. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public (browser-exposed) publishable key, `pk_test_…`. Unused by the app because Checkout is a hosted redirect. |
| `APP_URL` | Origin used for Stripe onboarding return URLs and as the fallback for Checkout returns. Set it to `https://localhost:3000` for local HTTPS dev. On Vercel, set it to the production URL (recommended); if unset, the request origin is used. Checkout returns buyers to the origin they clicked Buy Now on when that origin is one of the app's known origins (the request origin, `APP_URL`, or the Vercel deployment URLs), otherwise to `APP_URL`. When self-hosting behind a proxy, set `APP_URL` to the public URL. |
| `APP_SCOPE` | Optional unique id for this environment: a letter or digit first, then letters, digits, `.`, `_`, `:`, `-`, at most 100 characters. Lowercased and stored as `env:<value>`. Defaults to the Supabase project host. Required when `NEXT_PUBLIC_SUPABASE_URL` is a local Supabase (`localhost`, `127.0.0.1`, …) so environments sharing one Stripe sandbox never handle each other's checkouts; without it checkout is disabled. An invalid value disables checkout and makes the webhook return `503` until it is fixed. |

The Stripe publishable key is not needed because the app uses Stripe-hosted
Checkout. Replace the placeholders with real sandbox values: the server rejects
the placeholder key and payments stay disabled until you do.

### 3. Set up Supabase

In the Supabase Dashboard, open the SQL editor and run, in order:

1. `supabase/migrations/20261109000000_init_marketplace.sql`
2. `supabase/seed.sql`
3. `supabase/migrations/20261112000000_stripe_connect.sql`
4. `supabase/migrations/20261114000000_checkout_session_registry.sql`

The migration creates:

- `public.listings` and `public.messages` with indexes and an `updated_at`
  trigger.
- The public `listing-images` storage bucket.
- Row-level security policies: public read and insert for listings, insert-only
  for messages, and public read/insert for listing images.

The seed inserts 24 sample listings from four demo sellers
(`demo.seller1@example.com` to `demo.seller4@example.com`) across 12 categories.
Buy Now stays off for a demo seller's listings until you connect that email on
the Get paid page. The seed is optional; the app works with an empty database.

The Stripe Connect migration adds listing status, the `seller_accounts`,
`listing_holds` and `orders` tables, and the SQL functions used by checkout (see
[Database schema](#database-schema)). The registry migration adds the
`checkout_sessions` table and makes `record_paid_order` accept only registered
sessions.

To check the migration, paste `supabase/tests/stripe_connect_checks.sql` into
the SQL editor. It should return `ALL CHECKS PASSED` and leaves no data behind.

### Stripe sandbox setup

1. Create or open a Stripe account and switch to a **sandbox**.
2. In the Dashboard, open Connect and complete the platform setup as a
   marketplace where the platform collects payments. The app's seller
   accounts make Stripe liable for losses, so the platform doesn't need to
   accept loss liability. This also lets the app run on the shared assignment
   sandbox, where you have no Dashboard access.
3. Make sure Accounts v2 is available for the sandbox (the app creates
   seller accounts through the v2 API). Sellers get Stripe-liable accounts
   with the full Stripe Dashboard (merchant + recipient configurations),
   because recipient-only accounts require platform liability and the shared
   sandbox platform cannot be the losses collector.
4. Copy the sandbox secret key (`sk_test_…`) from Developers → API keys into
   `STRIPE_SECRET_KEY`.

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Running locally with Stripe

Stripe onboarding returns to `https://localhost:3000`, so use the HTTPS dev
server and set `APP_URL=https://localhost:3000`:

```bash
npm run dev:https
```

In another terminal, forward webhooks with the Stripe CLI:

```bash
stripe listen --forward-to https://localhost:3000/api/stripe/webhook --skip-verify
```

Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` and restart the dev
server. If you have not run `stripe login`, pass the key instead:
`stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to …`.

The checkout success page also records the order, so a purchase completes even
if the CLI is not running. Webhooks cover closed tabs and expired sessions.

Each Checkout Session carries an `app_scope` metadata value: `env:<APP_SCOPE>` if
set, otherwise the host of `NEXT_PUBLIC_SUPABASE_URL` (for example
`xyz.supabase.co`). The webhook and the success page ignore sessions whose
`app_scope` differs from their own, so environments sharing one Stripe sandbox
with a different Supabase project or a different `APP_SCOPE` never record or
refund each other's checkouts. Environments sharing one Supabase project share
a scope, which is fine because they share the data. A local Supabase host is the
same for every developer, so set a unique `APP_SCOPE` when using one.

Changing the app scope (setting or changing `APP_SCOPE`, or changing the
Supabase URL) makes checkouts opened before the change unrecognised. Change it
only when no checkout has been started in the last ~40 minutes. Webhook retries
still pending for sessions paid just before a scope change are ignored after it;
resend them if needed.

Stripe retries failed webhook deliveries only for a limited time (a few hours in
a sandbox, up to 3 days live). After fixing the app scope or webhook
configuration, resend failed `checkout.session.completed` events from the Stripe
Dashboard (Developers, Events or Webhooks) or with `stripe events resend <evt_id>`.
A resent event for a listing that has since been sold is refunded automatically.

### Try the full flow

1. Create a listing with your seller email (price of at least $0.50).
2. Open the listing. “Buy Now” is disabled because the seller has not set up
   payments.
3. Click “Get paid” in the header and enter the same email.
4. Click “Connect with Stripe” and complete Stripe's test onboarding.
   Test values: phone `000 000 0000`, SMS code `000000`, SSN last 4 / ID
   `0000` or `000-00-0000`, address line `address_full_match`, routing number
   `110000000`, account number `000123456789`.
5. Back on Get paid, the status flags show “Yes”.
6. Open the listing in another browser and click “Buy Now”.
7. Pay with `4242 4242 4242 4242`, any future expiry, and any CVC.
8. You land on “Order confirmed”. There is now an `orders` row in Supabase, the
   listing shows “Sold”, and the transfer is visible in the Stripe Dashboard.

### Useful commands

```bash
npm run lint      # ESLint
npx tsc --noEmit  # TypeScript check
npm test          # Vitest, once
npm run check     # tsc + eslint + vitest
npm run build     # Production build
npm run start     # Serve the production build
```

## Database schema

### `public.listings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `title` | `varchar(255)` | Required |
| `description` | `text` | Required by the app |
| `price` | `numeric(10,2)` | Required, `>= 0` |
| `category` | `varchar(100)` | Required; stores the display name |
| `condition` | `varchar(50)` | `New`, `Used - Like New`, `Used - Good`, `Used - Fair` |
| `seller_email` | `varchar(255)` | Required |
| `image_url` | `text` | Public Supabase Storage URL |
| `location` | `varchar(255)` | Defaults to `Palo Alto, CA` |
| `created_at` | `timestamptz` | Defaults to `now()` |
| `updated_at` | `timestamptz` | Defaults to `now()`; maintained by trigger |
| `status` | `text` | `active` (default) or `sold` |
| `sold_at` | `timestamptz` | Set when sold; non-null exactly when `status = 'sold'` |

### `public.messages`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `listing_id` | `uuid` | References `public.listings(id)` with cascade delete |
| `buyer_email` | `varchar(255)` | Required |
| `seller_email` | `varchar(255)` | Copied from the listing |
| `message` | `text` | 1–2000 characters |
| `created_at` | `timestamptz` | Defaults to `now()` |

Messages are insert-only through the API. There is intentionally no public
select policy, so the public anon key cannot read messages directly. The seller
inbox reads them server-side through `/api/messages` using the service-role
key (the Stripe Connect migration grants `select` on `messages` to
`service_role` explicitly).

### Stripe tables

`seller_accounts`, `listing_holds`, `orders` and `checkout_sessions` have row-level security enabled
with no policies, and access is revoked from `anon` and `authenticated`. Only
the service-role key can read or write them.

**`public.seller_accounts`**: `seller_email` (primary key, lowercase),
`stripe_account_id` (unique), `charges_enabled`, `payouts_enabled`,
`details_submitted`, `created_at`, `updated_at`.

**`public.listing_holds`**: one row per listing, `listing_id` (primary key,
cascade delete), `hold_token`, `checkout_session_id`, `checkout_url`,
`expires_at`, `created_at`.

**`public.orders`**: `id`, `listing_id`, `stripe_checkout_session_id` (unique),
`stripe_payment_intent_id`, `stripe_refund_id`, `seller_email`,
`seller_stripe_account_id`, `buyer_email`, `amount_cents` (`>= 50`),
`application_fee_cents`, `currency` (default `usd`), `status` (`paid`,
`refund_pending`, `refunded`), `created_at`, `updated_at`. A partial unique
index allows only one `paid` order per listing.

**`public.checkout_sessions`**: the registry of Checkout Sessions this app
created: `stripe_checkout_session_id` (primary key), `listing_id` (no foreign
key, so it survives listing deletion), `hold_token`, `amount_cents` (`>= 50`),
`currency`, `seller_stripe_account_id`, `application_fee_cents`, `created_at`.
Fulfilment and hold release trust these rows, never Stripe metadata.

### SQL functions

All are executable by `service_role` only.

- `reserve_listing(listing_id, hold_token, ttl_seconds)`: places a hold on an
  active listing unless an unexpired hold exists.
- `attach_hold_session(listing_id, hold_token, session_id, url)`: stores the
  Checkout Session on the hold.
- `release_listing_hold(listing_id, hold_token)`: removes the hold.
- `record_paid_order(...)`: records a paid session as an order and marks the
  listing sold; idempotent, and returns `refund_pending` if the listing was
  already sold.
- `mark_order_refunded(session_id, refund_id)`: marks a pending refund done.

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/listings` | Search and filter listings. Query params: `search`, `category`, `condition`, `location`, `minPrice`, `maxPrice`, `sort` (`newest`, `price_asc`, `price_desc`), `sellerEmail`. Returns `{ listings }` (limit 100). |
| `POST` | `/api/listings` | Create a listing. Body: `title`, `description`, `price`, `category`, `condition`, `seller_email`, `image_url`, `location`. Returns `201 { listing }`. |
| `GET` | `/api/listings/[id]` | Fetch one listing. Optional query param `holdToken` (a UUID from a previous checkout) so the buyer's own hold does not count as “reserved”. Returns `{ listing, purchase }`, or `404` for an invalid or missing id. `purchase` is `{ buyable: true, amountCents }` or `{ buyable: false, reason }` where `reason` is `free`, `below_minimum`, `above_maximum`, `sold`, `reserved`, `seller_not_onboarded`, or `payments_unavailable`. |
| `POST` | `/api/upload` | Multipart form-data with `file` (JPEG, PNG, or WebP, max 4 MB). Returns `201 { url }`. |
| `GET` | `/api/messages` | Seller inbox. Query param: `sellerEmail`. Returns `{ messages }`, newest first, capped at 100, with listing title, image, and price. `400` for a missing or invalid email; `500` when the service-role key is absent or Supabase fails. |
| `POST` | `/api/messages` | Send a message. Body: `listing_id`, `buyer_email`, `message`. Returns `201 { message }`, `400` on validation failure, or `404` when the listing is missing. Messages appear in the seller inbox but no automatic email is sent. |
| `POST` | `/api/stripe/connect/onboard` | Start or resume seller onboarding. Body: `{ email }`. Returns `{ url }` (Stripe onboarding link) while details are still needed, or `{ status }` (`charges_enabled`, `payouts_enabled`, `details_submitted`) once the seller has submitted everything. `400` for an invalid email, `409` if the linked Stripe account no longer exists, `500` on database errors, `502` on Stripe errors, `503` when payments are not configured. |
| `GET` | `/api/stripe/connect/status` | Seller payout status. Query param: `email`. Returns `{ status }` with the three flags above, or `{ status: null }` when the email has not started onboarding. Not cached. `400`, `500`, `502`, `503` as above. |
| `POST` | `/api/checkout` | Start Checkout for a listing. Body: `{ listingId, holdToken? }`. The amount comes from the database, never the client. Returns `{ url, holdToken }` to redirect to Stripe Checkout (passing the previous `holdToken` resumes an open session). Blocked purchases return `409 { error, reason }` with a reason from the list above; also `400`, `404`, `500`, `502`, `503`. |
| `POST` | `/api/checkout/cancel` | Cancel the buyer's checkout. Body: `{ listingId, holdToken }` (both UUIDs). Expires the open Checkout Session and releases the hold. Returns `{ result }` where `result` is `cancelled`, `already_paid` (the session was paid), `refunded` (paid, but the item was already sold, so the payment was refunded), or `unknown` (the hold is gone, Stripe could not be reached, or a paid session could not be confirmed yet). `400` for an invalid body, `503` when not configured. |
| `POST` | `/api/stripe/webhook` | Stripe webhook. Verifies the `stripe-signature` header, then handles `checkout.session.completed` and `checkout.session.async_payment_succeeded` (record the order) and `checkout.session.expired` (release the hold). Sessions whose `app_scope` metadata belongs to another environment (another Supabase project or `APP_SCOPE`) are ignored. Returns `{ received: true }`; `400` for a missing or invalid signature, `500` so Stripe retries on failure, `503` when not configured or, for a correctly signed event, when the app scope is unavailable (Stripe retries for a limited time, a few hours in a sandbox; resend failed events afterwards). |

Validation errors return `{ error: string }` with status `400`. Storage or
database failures return `500`.

The hold token never appears in a URL. “Buy Now” keeps it in `sessionStorage`
(`hold:<listingId>`); Stripe's cancel URL is `/checkout/cancel?listing=<id>`,
and that page posts the saved token to `/api/checkout/cancel` from the browser.

## Deploying to Vercel

1. Push the repository to GitHub.
2. Import the repository in Vercel.
3. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` to Production, Preview, and Development. For
   payments also add `STRIPE_SECRET_KEY` (sandbox key) and
   `PLATFORM_FEE_BPS` to override the 10% default fee. Set `APP_URL` to the production URL
   (recommended) so Stripe onboarding redirects always go to the production
   domain; if it is unset, the request origin is used. Checkout returns buyers
   to the origin they started from when it is one of the app's known origins
   (the request origin, `APP_URL`, or the Vercel deployment URLs), otherwise to
   `APP_URL`.
4. In the Stripe Dashboard, create a webhook endpoint for the **production**
   URL `/api/stripe/webhook` with the events `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, and `checkout.session.expired`.
   Listen to events on your own account only (not "Connected accounts"), as
   snapshot events. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Preview deployments sit
   behind Vercel deployment protection, so Stripe cannot reach their webhooks.
   The endpoint only handles sessions whose `app_scope` metadata matches
   production's app scope, so local `stripe listen` sessions on the same
   sandbox are ignored (and vice versa).

   **Webhook setup (shared sandbox).** Instead of the Dashboard, run the
   setup script yourself (it prints the signing secret, so run it only in your
   own terminal):

   ```bash
   node --env-file=.env.local scripts/create-webhook.mjs            # create
   node --env-file=.env.local scripts/create-webhook.mjs --dry-run  # plan only, creates nothing
   node --env-file=.env.local scripts/create-webhook.mjs --replace  # create the new endpoint first, then remove the old one
   ```

   With `--replace` the script creates the new endpoint first and only then
   deletes the old one; afterwards update `STRIPE_WEBHOOK_SECRET` and redeploy.

   It registers the production URL with `connect: false`, because destination
   charges create their events on the platform account, not on a connected
   account. The three events are `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, and `checkout.session.expired`.
   Other candidates' endpoints in the shared sandbox may send you events
   too; they get a 200 and are ignored because their `app_scope` metadata does
   not match. Only sessions this app created and registered in
   `checkout_sessions` are fulfilled, so forged sessions made with the shared key
   are ignored. The signing secret is shown once, at creation. If an endpoint with
   this exact URL already exists the script exits; only `--replace` deletes
   those endpoints (never others) and creates a fresh one. Then set
   `STRIPE_WEBHOOK_SECRET` in Vercel (Production) and redeploy.
5. Deploy. Pushing to `main` triggers a new production deployment.
6. Smoke-test the deployment: browse and search, create a listing with a photo,
   send a message, then read it in `/messages` using that listing’s seller
   email. Confirm the service-role key never appears in the browser bundle. To test
   payments, run the full flow above against the production URL.

## Testing

```bash
npm test          # Vitest, once
npm run check     # tsc --noEmit, eslint, and the tests
```

`supabase/tests/stripe-connect.sql.test.ts` runs the Stripe Connect and checkout session registry
migrations and `supabase/tests/stripe_connect_checks.sql` against an in-memory Postgres
(PGlite), including a mode without Supabase's automatic grants. The CI workflow
(`.github/workflows/ci.yml`) runs `npm ci`, `npm run build`, and `npm run check`
on every push and pull request with read-only repository permissions.

## Known limitations

- No authentication or accounts. Listings are open to anyone with the URL.
- “Your listings” is browser-local: it remembers the seller email in
  `localStorage` under `marketplace_seller_email`, so it does not sync across
  devices or browsers.
- Messages are stored in Supabase and read through an email-keyed seller inbox;
  no automatic email notification is sent.
- There are no accounts. The inbox is keyed by the seller email and is not
  secure authentication: anyone who knows a seller email can view that inbox.
  Do not use it for sensitive messages.
- The public anon key still cannot read the `messages` table; inbox reads use a
  server-only service-role key inside the API route.
- Payouts are keyed by the typed seller email, with no login. Anyone can claim
  an email that has not onboarded yet, so this is sandbox/demo only and needs
  real authentication before any live use.
- No rate limiting on the onboarding, status, and checkout endpoints. Anyone
  can keep a listing reserved by starting a new checkout every 30–40 minutes.
- Once a seller has submitted their details, the app stops issuing onboarding
  links for that email. If Stripe later asks for more information, the seller
  has to update it through Stripe directly.
- No refund UI. Refunds only happen automatically when a second payment lands
  on an already-sold listing, or when the listing was deleted before payment.
- On a public sandbox deployment anyone can “buy” a listing with Stripe's
  public test card (`4242 4242 4242 4242`) and mark it sold. There is no admin
  reset in the app.
- Sold listings stay visible with a “Sold” badge.
- One item per checkout, USD only.
- No radius/distance filtering and no pagination; results are capped at 100.
- The app does not edit or delete listings.
- Free Supabase projects pause after a period of inactivity, which can make the
  live demo unavailable until the project is resumed.

## Project structure

```text
src/
  app/
    api/            # listings, listing detail, messages, upload, checkout, stripe
    checkout/       # success and cancel pages
    seller/payments # seller payout setup (Get paid)
    category/[slug] # category pages
    create/         # choose type and create item
    item/[id]       # listing detail
    messages/       # seller inbox
    seller-help/
    your-listings/
  components/
    layout/         # header, sidebar, logo
    marketplace/    # cards, grid, browser, filters, forms, detail
    ui/             # shadcn/ui primitives
  lib/              # categories, conditions, formatting, validation, image,
                    # Supabase clients (supabase-admin.ts is server-only)
supabase/
  migrations/       # schema, policies, bucket, trigger, Stripe Connect
  tests/            # PGlite SQL tests and the manual checks script
  seed.sql          # 24 sample listings
```
