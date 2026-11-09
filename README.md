# Marketplace

A Facebook Marketplace–inspired buying and selling app built for the Notion
“Test 3: Marketplace” challenge. Visitors can create a listing with a photo,
browse and search listings, filter by category, price, condition, location, and
sort order, open a listing, and send a message to the seller.

**Live demo:** _Add the deployed Vercel URL here after deployment._

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
- “Your listings” view scoped to the email saved in this browser.
- Loading skeletons, empty states, error retry, and a custom not-found page.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15.5.29 (App Router, Turbopack) |
| UI | React 19.1.0, Tailwind CSS 3.4, shadcn/ui, lucide-react |
| Language | TypeScript 5 |
| Database | Supabase Postgres |
| Storage | Supabase Storage (`listing-images` bucket) |
| Hosting | Vercel |

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your Supabase publishable key:

```bash
cp .env.local.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
```

The publishable/anon key is safe for browser use. Never expose a service-role
key through `NEXT_PUBLIC_*` variables.

### 3. Set up Supabase

In the Supabase Dashboard, open the SQL editor and run, in order:

1. `supabase/migrations/20261109000000_init_marketplace.sql`
2. `supabase/seed.sql`

The migration creates:

- `public.listings` and `public.messages` with indexes and an `updated_at`
  trigger.
- The public `listing-images` storage bucket.
- Row-level security policies: public read and insert for listings, insert-only
  for messages, and public read/insert for listing images.

The seed inserts 12 sample listings, including one free listing. The seed is
optional; the app works with an empty database.

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Useful commands

```bash
npm run lint      # ESLint
npx tsc --noEmit  # TypeScript check
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
select policy, so messages cannot be read from the browser.

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/listings` | Search and filter listings. Query params: `search`, `category`, `condition`, `location`, `minPrice`, `maxPrice`, `sort` (`newest`, `price_asc`, `price_desc`), `sellerEmail`. Returns `{ listings }` (limit 100). |
| `POST` | `/api/listings` | Create a listing. Body: `title`, `description`, `price`, `category`, `condition`, `seller_email`, `image_url`, `location`. Returns `201 { listing }`. |
| `GET` | `/api/listings/[id]` | Fetch one listing. Returns `{ listing }`, or `404` for an invalid or missing id. |
| `POST` | `/api/upload` | Multipart form-data with `file` (JPEG, PNG, or WebP, max 4 MB). Returns `201 { url }`. |
| `POST` | `/api/messages` | Send a message. Body: `listing_id`, `buyer_email`, `message`. Returns `201 { message }`, `400` on validation failure, or `404` when the listing is missing. |

Validation errors return `{ error: string }` with status `400`. Storage or
database failures return `500`.

## Deploying to Vercel

1. Push the repository to GitHub.
2. Import the repository in Vercel.
3. Add the environment variables `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the Production environment.
4. Deploy. Pushing to `main` triggers a new production deployment.

## Known limitations

- No authentication or accounts. Listings are open to anyone with the URL.
- “Your listings” is browser-local: it remembers the seller email in
  `localStorage` under `marketplace_seller_email`, so it does not sync across
  devices or browsers.
- Messages are stored in Supabase, but no email is delivered. The seller email
  is shown on the listing for direct contact.
- No radius/distance filtering and no pagination; results are capped at 100.
- The app does not edit or delete listings.
- Free Supabase projects pause after a period of inactivity, which can make the
  live demo unavailable until the project is resumed.

## Project structure

```text
src/
  app/
    api/            # listings, listing detail, messages, upload
    category/[slug] # category pages
    create/         # choose type and create item
    item/[id]       # listing detail
    seller-help/
    your-listings/
  components/
    layout/         # header, sidebar, logo
    marketplace/    # cards, grid, browser, filters, forms, detail
    ui/             # shadcn/ui primitives
  lib/              # categories, conditions, formatting, validation, image
supabase/
  migrations/       # schema, policies, bucket, trigger
  seed.sql          # 12 sample listings
```
