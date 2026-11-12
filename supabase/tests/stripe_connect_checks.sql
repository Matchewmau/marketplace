-- Stripe Connect SQL checks.
-- Paste into the Supabase SQL editor AFTER applying
-- supabase/migrations/20261112000000_stripe_connect.sql.
-- Everything runs inside a transaction that is rolled back, so no data is left behind.
-- Success: notice "ALL CHECKS PASSED". Failure: an exception describing the failed check.

begin;

do $$
declare
  v_listing_id uuid;
  v_token_a uuid := gen_random_uuid();
  v_token_b uuid := gen_random_uuid();
  v_bool boolean;
  v_result text;
  v_status text;
  v_sold_at timestamptz;
  v_count integer;
begin
  insert into public.listings (title, price, category, seller_email)
  values ('Stripe check listing', 25.00, 'Test', 'seller@example.com')
  returning id into v_listing_id;

  -- Reservation: first hold wins, second is rejected while the first is live.
  v_bool := public.reserve_listing(v_listing_id, v_token_a, 2400);
  if v_bool is distinct from true then
    raise exception 'CHECK FAILED: first reserve_listing should return true, got %', v_bool;
  end if;

  v_bool := public.reserve_listing(v_listing_id, v_token_b, 2400);
  if v_bool is distinct from false then
    raise exception 'CHECK FAILED: second reserve_listing on held listing should return false, got %', v_bool;
  end if;

  -- Expired hold can be taken over.
  update public.listing_holds set expires_at = now() - interval '1 second' where listing_id = v_listing_id;
  v_bool := public.reserve_listing(v_listing_id, v_token_b, 2400);
  if v_bool is distinct from true then
    raise exception 'CHECK FAILED: reserve_listing after hold expiry should return true, got %', v_bool;
  end if;

  -- First payment records the order and marks the listing sold.
  v_result := public.record_paid_order('cs_test_1', 'pi_test_1', v_listing_id, 'buyer@example.com', 2500, 125, 'acct_test_1');
  if v_result is distinct from 'recorded' then
    raise exception 'CHECK FAILED: first record_paid_order should return recorded, got %', v_result;
  end if;

  select status, sold_at into v_status, v_sold_at from public.listings where id = v_listing_id;
  if v_status is distinct from 'sold' then
    raise exception 'CHECK FAILED: listing status should be sold, got %', v_status;
  end if;
  if v_sold_at is null then
    raise exception 'CHECK FAILED: listing sold_at should be set';
  end if;

  select count(*) into v_count from public.listing_holds where listing_id = v_listing_id;
  if v_count <> 0 then
    raise exception 'CHECK FAILED: hold row should be deleted after payment, found %', v_count;
  end if;

  -- Replayed webhook for the same session is a duplicate.
  v_result := public.record_paid_order('cs_test_1', 'pi_test_1', v_listing_id, 'buyer@example.com', 2500, 125, 'acct_test_1');
  if v_result is distinct from 'duplicate' then
    raise exception 'CHECK FAILED: replayed record_paid_order should return duplicate, got %', v_result;
  end if;

  select count(*) into v_count from public.orders where listing_id = v_listing_id;
  if v_count <> 1 then
    raise exception 'CHECK FAILED: expected exactly 1 order after duplicate, found %', v_count;
  end if;

  -- Second buyer for an already-sold listing needs a refund.
  v_result := public.record_paid_order('cs_test_2', 'pi_test_2', v_listing_id, 'late@example.com', 2500, 125, 'acct_test_1');
  if v_result is distinct from 'refund_pending' then
    raise exception 'CHECK FAILED: record_paid_order on sold listing should return refund_pending, got %', v_result;
  end if;

  v_result := public.record_paid_order('cs_test_2', 'pi_test_2', v_listing_id, 'late@example.com', 2500, 125, 'acct_test_1');
  if v_result is distinct from 'refund_pending' then
    raise exception 'CHECK FAILED: replayed refund_pending order should return refund_pending, got %', v_result;
  end if;

  perform public.mark_order_refunded('cs_test_2', 're_test');
  select status into v_status from public.orders where stripe_checkout_session_id = 'cs_test_2';
  if v_status is distinct from 'refunded' then
    raise exception 'CHECK FAILED: order cs_test_2 should be refunded, got %', v_status;
  end if;

  v_result := public.record_paid_order('cs_test_2', 'pi_test_2', v_listing_id, 'late@example.com', 2500, 125, 'acct_test_1');
  if v_result is distinct from 'duplicate' then
    raise exception 'CHECK FAILED: record_paid_order after refund should return duplicate, got %', v_result;
  end if;

  select count(*) into v_count from public.orders where listing_id = v_listing_id and status = 'paid';
  if v_count <> 1 then
    raise exception 'CHECK FAILED: expected exactly 1 paid order for listing, found %', v_count;
  end if;

  -- Sold listings cannot be reserved.
  v_bool := public.reserve_listing(v_listing_id, gen_random_uuid(), 2400);
  if v_bool is distinct from false then
    raise exception 'CHECK FAILED: reserve_listing on sold listing should return false, got %', v_bool;
  end if;

  -- Privileges: anon cannot execute functions or read orders.
  if has_function_privilege('anon', 'public.reserve_listing(uuid,uuid,integer)', 'execute') then
    raise exception 'CHECK FAILED: anon must not execute reserve_listing';
  end if;
  if has_function_privilege('anon', 'public.record_paid_order(text,text,uuid,text,integer,integer,text)', 'execute') then
    raise exception 'CHECK FAILED: anon must not execute record_paid_order';
  end if;
  if has_table_privilege('anon', 'public.orders', 'select') then
    raise exception 'CHECK FAILED: anon must not select from orders';
  end if;

  raise notice 'ALL CHECKS PASSED';
end;
$$;

rollback;
