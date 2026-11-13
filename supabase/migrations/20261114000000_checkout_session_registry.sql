-- Checkout Session registry: the Checkout Sessions this app created. Stripe metadata is never
-- trusted (the sandbox key is shared), so fulfilment and hold release rely on these rows.
-- Deliberately no foreign key to listings, so the record survives listing deletion.

create table if not exists public.checkout_sessions (
  stripe_checkout_session_id text primary key,
  listing_id uuid not null,
  hold_token uuid not null,
  amount_cents integer not null check (amount_cents >= 50),
  currency text not null default 'usd',
  seller_stripe_account_id text not null,
  application_fee_cents integer not null default 0 check (application_fee_cents >= 0),
  created_at timestamptz not null default now()
);

alter table public.checkout_sessions enable row level security;
revoke all on table public.checkout_sessions from anon, authenticated;
grant select, insert, update, delete on table public.checkout_sessions to service_role;

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
  v_registry public.checkout_sessions%rowtype;
begin
  -- Only sessions this app created (and registered) can become orders; Stripe metadata is
  -- never trusted. Nothing is touched when the session is unknown or does not match.
  select * into v_registry
    from public.checkout_sessions
   where stripe_checkout_session_id = p_session_id;
  if not found
     or v_registry.listing_id is distinct from p_listing_id
     or v_registry.amount_cents is distinct from p_amount_cents
     or v_registry.seller_stripe_account_id is distinct from p_seller_account_id
     or v_registry.application_fee_cents is distinct from coalesce(p_fee_cents, 0) then
    return 'unrecognized';
  end if;

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
    if v_existing_status = 'refunded' then
      return 'refunded';
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
