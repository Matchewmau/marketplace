# Plan: fixed-size testing guide, consistent items and pages, seller email on listings

**Status:** drafted, revision 2. User decisions (2026-11-13):
- No seller email on listing cards. U2 is dropped, and the item page stays as it is.
- Rename the 3 legacy test listings (U4 approved).
- Keep the current price format ($25 / $12.50, no change).

Tier 1–2 (UI only, plus one approved data fix). Branch `stripe-integration`, local commits only.

**Goal:** the testing guide keeps one size across tabs; listing cards show the email used to list each item; back navigation looks and behaves the same everywhere; test data follows one naming scheme.

**Audit evidence (2026-11-13):**
- Guide height per tab at 1280×800: Quick start 470, Test cards 647, Seller setup 669, Tips 436 (width constant at 547).
- All 29 listing cards are 289 px tall. Three test listings use "Stripe test item… (please ignore)" while ten use "[Test] …".
- The seller email appears only on the item page.
- Back links:
  - Inline in 4 files with 3 different styles; only `/seller/payments` has the 44 px target and a focus ring.
  - `/your-listings`, `/create` and `/create/item` have none.

## Units

### U1 — Fixed-size guide (mechanical)
- **File:** `src/components/layout/testing-guide.tsx`.
- **Change:** on the `<dialog>`, replace `max-h-[min(88vh,760px)]` with `h-[min(85dvh,640px)]`. The inner flex column keeps the header and tabs fixed, and only the panel scrolls.
- **Accept:** `dialog.getBoundingClientRect().height` is identical on all 4 tabs, at both 1280×800 and 375×812. Seller setup scrolls inside the panel, and the page behind stays locked.

### U2 — dropped
The user removed seller email on cards. No card or item-page changes.

### U3 — Shared back link (integration)
- **New:** `src/components/layout/back-link.tsx`, exporting `BackLink({ href = "/", children = "Back to Marketplace" }: { href?: string; children?: React.ReactNode })`.
  - It is server-safe, with no hooks.
  - It uses the styling from `/seller/payments`: `min-h-11`, `focus-visible:ring-brand`, and an `ArrowLeft` icon with `aria-hidden`.
- **Use it in:**
  - `listing-detail.tsx` (~l.147)
  - `src/app/messages/page.tsx` (~l.183)
  - `src/app/seller-help/page.tsx` (~l.40)
  - `src/app/seller/payments/page.tsx`
  - `src/app/your-listings/page.tsx` (top)
  - `src/components/marketplace/create-listing-form.tsx` (above the h1, `href="/create"`, "Back to listing types")
  - `src/app/create/page.tsx` (top)
- **Accept:**
  - `grep -rn "ArrowLeft" src --include=*.tsx` shows matches only in `back-link.tsx` and `testing-guide.tsx`.
  - Every back link is ≥44 px tall.

### U4 — Rename legacy test listings (data, needs approval)
- **Change:** use the Supabase service-role PATCH on `listings.title` for 3 rows:
  - `66f4dc04…` → "[Test] Item from a seller who isn't set up"
  - `58d1a293…` → "[Test] Test item 2"
  - `c3ea66ae…` → "[Test] Test item 3"
- **Accept:** `GET /api/listings` has no title containing "please ignore".

## Verification
- `npm run check` exits 0, and `npm run build` succeeds.
- Browser at 1280×800 and 375×812:
  - guide heights equal across tabs;
  - back links render on all 7 pages.
- One `code-reviewer` per commit.

## Risks
- `dvh` needs a modern browser; older ones ignore it and fall back to normal height.
