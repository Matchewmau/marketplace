-- Stripe Connect payments: listing status, seller accounts, holds, orders and
-- transactional SQL functions. All new tables and functions are service-role only.

alter table public.listings
  add column if not exists status text not null default 'active' check (status in ('active','sold')),
  add column if not exists sold_at timestamptz;

alter table public.listings drop constraint if exists listings_sold_at_matches_status;
alter table public.listings
  add constraint listings_sold_at_matches_status check ((status = 'sold') = (sold_at is not null));

-- New listings can only be created as active (sold state is set by record_paid_order).
drop policy if exists "Anyone can create listings" on public.listings;
create policy "Anyone can create listings" on public.listings
  for insert with check (status = 'active' and sold_at is null);

-- Server-side RPCs read and update listings as service_role; do not rely on automatic grants.
grant select, update on table public.listings to service_role;

-- The seller inbox (src/app/api/messages/route.ts) reads messages through the admin client;
-- do not depend on Supabase's automatic grants.
grant select on public.messages to service_role;

-- Hardening: pin search_path and keep the trigger function off the public API.
alter function public.update_updated_at_column() set search_path = public;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated;

-- Seller Stripe accounts --------------------------------------------------------

create table if not exists public.seller_accounts (
  seller_email varchar(255) primary key check (seller_email = lower(seller_email)),
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_seller_accounts_updated_at on public.seller_accounts;
create trigger update_seller_accounts_updated_at
before update on public.seller_accounts
for each row execute function public.update_updated_at_column();

alter table public.seller_accounts enable row level security;
revoke all on table public.seller_accounts from anon, authenticated;
grant select, insert, update, delete on table public.seller_accounts to service_role;

-- Listing holds (checkout reservations) -----------------------------------------

create table if not exists public.listing_holds (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  hold_token uuid not null,
  checkout_session_id text,
  checkout_url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.listing_holds enable row level security;
revoke all on table public.listing_holds from anon, authenticated;
grant select, insert, update, delete on table public.listing_holds to service_role;

-- Orders ------------------------------------------------------------------------

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  stripe_refund_id text,
  seller_email varchar(255) not null,
  seller_stripe_account_id text not null,
  buyer_email text,
  amount_cents integer not null check (amount_cents >= 50),
  application_fee_cents integer not null default 0 check (application_fee_cents >= 0),
  currency char(3) not null default 'usd',
  status text not null check (status in ('paid','refund_pending','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_orders_updated_at on public.orders;
create trigger update_orders_updated_at
before update on public.orders
for each row execute function public.update_updated_at_column();

create unique index if not exists orders_one_paid_per_listing on public.orders(listing_id) where status = 'paid';
create index if not exists idx_orders_listing_id on public.orders(listing_id);

alter table public.orders enable row level security;
revoke all on table public.orders from anon, authenticated;
grant select, insert, update, delete on table public.orders to service_role;

-- Functions ---------------------------------------------------------------------

create or replace function public.reserve_listing(p_listing_id uuid, p_hold_token uuid, p_ttl_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform 1 from public.listings where id = p_listing_id and status = 'active' for update;
  if not found then
    return false;
  end if;

  insert into public.listing_holds (listing_id, hold_token, expires_at)
  values (p_listing_id, p_hold_token, now() + make_interval(secs => p_ttl_seconds))
  on conflict (listing_id) do update
    set hold_token = excluded.hold_token,
        expires_at = excluded.expires_at,
        checkout_session_id = null,
        checkout_url = null,
        created_at = now()
    where public.listing_holds.expires_at < now();

  return found;
end;
$$;

revoke all on function public.reserve_listing(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_listing(uuid, uuid, integer) to service_role;

create or replace function public.attach_hold_session(p_listing_id uuid, p_hold_token uuid, p_session_id text, p_url text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.listing_holds
     set checkout_session_id = p_session_id,
         checkout_url = p_url
   where listing_id = p_listing_id
     and hold_token = p_hold_token;
end;
$$;

revoke all on function public.attach_hold_session(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.attach_hold_session(uuid, uuid, text, text) to service_role;

create or replace function public.release_listing_hold(p_listing_id uuid, p_hold_token uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.listing_holds
   where listing_id = p_listing_id
     and hold_token = p_hold_token;
end;
$$;

revoke all on function public.release_listing_hold(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_listing_hold(uuid, uuid) to service_role;

create or replace function public.record_paid_order(
  p_session_id text,
  p_payment_intent_id text,
  p_listing_id uuid,
  p_buyer_email text,
  p_amount_cents integer,
  p_fee_cents integer,
  p_seller_account_id text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_seller_email varchar(255);
  v_existing_status text;
begin
  select status, seller_email into v_status, v_seller_email
    from public.listings
   where id = p_listing_id
   for update;
  if not found then
    raise exception 'listing % not found', p_listing_id;
  end if;

  select status into v_existing_status
    from public.orders
   where stripe_checkout_session_id = p_session_id;
  if found then
    if v_existing_status = 'refund_pending' then
      return 'refund_pending';
    end if;
    return 'duplicate';
  end if;

  if v_status = 'sold' then
    insert into public.orders (
      listing_id, stripe_checkout_session_id, stripe_payment_intent_id, seller_email,
      seller_stripe_account_id, buyer_email, amount_cents, application_fee_cents, status
    ) values (
      p_listing_id, p_session_id, p_payment_intent_id, lower(v_seller_email),
      p_seller_account_id, p_buyer_email, p_amount_cents, coalesce(p_fee_cents, 0), 'refund_pending'
    );
    return 'refund_pending';
  end if;

  insert into public.orders (
    listing_id, stripe_checkout_session_id, stripe_payment_intent_id, seller_email,
    seller_stripe_account_id, buyer_email, amount_cents, application_fee_cents, status
  ) values (
    p_listing_id, p_session_id, p_payment_intent_id, lower(v_seller_email),
    p_seller_account_id, p_buyer_email, p_amount_cents, coalesce(p_fee_cents, 0), 'paid'
  );

  update public.listings set status = 'sold', sold_at = now() where id = p_listing_id;
  delete from public.listing_holds where listing_id = p_listing_id;

  return 'recorded';
end;
$$;

revoke all on function public.record_paid_order(text, text, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.record_paid_order(text, text, uuid, text, integer, integer, text) to service_role;

create or replace function public.mark_order_refunded(p_session_id text, p_refund_id text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.orders
     set status = 'refunded',
         stripe_refund_id = p_refund_id
   where stripe_checkout_session_id = p_session_id
     and status = 'refund_pending';
end;
$$;

revoke all on function public.mark_order_refunded(text, text) from public, anon, authenticated;
grant execute on function public.mark_order_refunded(text, text) to service_role;
