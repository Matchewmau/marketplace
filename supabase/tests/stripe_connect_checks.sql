-- Stripe Connect SQL checks.
-- Paste into the Supabase SQL editor AFTER applying
-- supabase/migrations/20261112000000_stripe_connect.sql and
-- supabase/migrations/20261114000000_checkout_session_registry.sql.
-- Everything runs inside a transaction that is rolled back, so no data is left behind.
-- Success: the final result set shows "ALL CHECKS PASSED" (the SQL editor only displays the
-- last statement's result; any failed check raises and aborts the batch before it).
-- Failure: an exception describing the failed check.

begin;

do $$
declare
  v_listing_id uuid;
  v_listing2_id uuid;
  v_token_a uuid := gen_random_uuid();
  v_token_b uuid := gen_random_uuid();
  v_bool boolean;
  v_result text;
  v_status text;
  v_sold_at timestamptz;
  v_count integer;
  v_fee integer;
  v_email text;
  v_refund_id text;
  v_session text;
  v_ts timestamptz;
  v_role text;
  v_sig text;
  v_tbl text;
  v_priv text;
begin
  insert into public.listings (title, price, category, seller_email)
  values ('Stripe check listing', 25.00, 'Test', 'seller@example.com')
  returning id into v_listing_id;

  insert into public.listings (title, price, category, seller_email)
  values ('Stripe check listing 2', 10.00, 'Test', 'Mixed.Case@Example.com')
  returning id into v_listing2_id;

  -- Constraint: a sold listing must have sold_at (and vice versa), even for the owner.
  begin
    insert into public.listings (title, price, category, seller_email, status)
    values ('Bad sold listing', 1.00, 'Test', 'seller@example.com', 'sold');
    raise exception 'CHECK FAILED: sold listing without sold_at should violate listings_sold_at_matches_status';
  exception when check_violation then
    null;
  end;

  -- Anon may create active listings but not sold ones.
  set local role anon;
  begin
    insert into public.listings (title, price, category, seller_email)
    values ('Anon active listing', 5.00, 'Test', 'anon-seller@example.com');
  exception when others then
    reset role;
    raise exception 'CHECK FAILED: anon should be able to insert an active listing (%)', sqlerrm;
  end;
  begin
    insert into public.listings (title, price, category, seller_email, status, sold_at)
    values ('Anon sold listing', 5.00, 'Test', 'anon-seller@example.com', 'sold', now());
    reset role;
    raise exception 'CHECK FAILED: anon must not insert a sold listing';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  -- Business-logic functions run as service_role, like the server's service-role client.
  set local role service_role;

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

  -- attach/release with a non-matching token do nothing.
  perform public.attach_hold_session(v_listing_id, v_token_a, 'cs_wrong', 'https://wrong.example');
  select checkout_session_id into v_session from public.listing_holds where listing_id = v_listing_id;
  if v_session is not null then
    raise exception 'CHECK FAILED: attach_hold_session with wrong token must not set session, got %', v_session;
  end if;

  perform public.release_listing_hold(v_listing_id, v_token_a);
  select count(*) into v_count from public.listing_holds where listing_id = v_listing_id;
  if v_count <> 1 then
    raise exception 'CHECK FAILED: release_listing_hold with wrong token must keep the hold, found %', v_count;
  end if;

  perform public.attach_hold_session(v_listing_id, v_token_b, 'cs_test_1', 'https://ok.example');
  select checkout_session_id into v_session from public.listing_holds where listing_id = v_listing_id;
  if v_session is distinct from 'cs_test_1' then
    raise exception 'CHECK FAILED: attach_hold_session with matching token should set session, got %', v_session;
  end if;

  -- record_paid_order only accepts sessions registered by this app, with matching values.
  v_result := public.record_paid_order('cs_test_1', 'pi_test_1', v_listing_id, 'buyer@example.com', 2500, 125, 'acct_test_1');
  if v_result is distinct from 'unrecognized' then
    raise exception 'CHECK FAILED: record_paid_order without a registry row should return unrecognized, got %', v_result;
  end if;

  insert into public.checkout_sessions (
    stripe_checkout_session_id, listing_id, hold_token, amount_cents, seller_stripe_account_id, application_fee_cents
  ) values ('cs_test_1', v_listing_id, v_token_b, 2500, 'acct_test_1', 125);

  v_result := public.record_paid_order('cs_test_1', 'pi_test_1', v_listing_id, 'buyer@example.com', 2400, 125, 'acct_test_1');
  if v_result is distinct from 'unrecognized' then
    raise exception 'CHECK FAILED: amount mismatch should return unrecognized, got %', v_result;
  end if;
  v_result := public.record_paid_order('cs_test_1', 'pi_test_1', v_listing_id, 'buyer@example.com', 2500, 125, 'acct_attacker');
  if v_result is distinct from 'unrecognized' then
    raise exception 'CHECK FAILED: seller mismatch should return unrecognized, got %', v_result;
  end if;
  v_result := public.record_paid_order('cs_test_1', 'pi_test_1', v_listing_id, 'buyer@example.com', 2500, 0, 'acct_test_1');
  if v_result is distinct from 'unrecognized' then
    raise exception 'CHECK FAILED: fee mismatch should return unrecognized, got %', v_result;
  end if;
  v_result := public.record_paid_order('cs_test_1', 'pi_test_1', v_listing2_id, 'buyer@example.com', 2500, 125, 'acct_test_1');
  if v_result is distinct from 'unrecognized' then
    raise exception 'CHECK FAILED: listing mismatch should return unrecognized, got %', v_result;
  end if;

  select status into v_status from public.listings where id = v_listing_id;
  if v_status is distinct from 'active' then
    raise exception 'CHECK FAILED: listing must stay active after unrecognized sessions, got %', v_status;
  end if;
  select count(*) into v_count from public.orders where listing_id = v_listing_id;
  if v_count <> 0 then
    raise exception 'CHECK FAILED: unrecognized sessions must not create orders, found %', v_count;
  end if;
  select count(*) into v_count from public.listing_holds where listing_id = v_listing_id;
  if v_count <> 1 then
    raise exception 'CHECK FAILED: unrecognized sessions must not release the hold, found %', v_count;
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

  -- A paid order is not touched by mark_order_refunded.
  perform public.mark_order_refunded('cs_test_1', 're_x');
  select status, stripe_refund_id into v_status, v_refund_id from public.orders where stripe_checkout_session_id = 'cs_test_1';
  if v_status is distinct from 'paid' or v_refund_id is not null then
    raise exception 'CHECK FAILED: mark_order_refunded must not change a paid order, got % / %', v_status, v_refund_id;
  end if;

  -- Only one paid order per listing is enforced by the unique index.
  begin
    insert into public.orders (listing_id, stripe_checkout_session_id, seller_email, seller_stripe_account_id, amount_cents, status)
    values (v_listing_id, 'cs_dup_paid', 'seller@example.com', 'acct_test_1', 2500, 'paid');
    raise exception 'CHECK FAILED: second paid order for a listing should violate orders_one_paid_per_listing';
  exception when unique_violation then
    null;
  end;

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
  insert into public.checkout_sessions (
    stripe_checkout_session_id, listing_id, hold_token, amount_cents, seller_stripe_account_id, application_fee_cents
  ) values ('cs_test_2', v_listing_id, gen_random_uuid(), 2500, 'acct_test_1', 125);
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
  if v_result is distinct from 'refunded' then
    raise exception 'CHECK FAILED: record_paid_order after refund should return refunded, got %', v_result;
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

  -- NULL fee records 0; seller email is stored lower-cased.
  insert into public.checkout_sessions (
    stripe_checkout_session_id, listing_id, hold_token, amount_cents, seller_stripe_account_id
  ) values ('cs_test_3', v_listing2_id, gen_random_uuid(), 1000, 'acct_test_2');

  v_result := public.record_paid_order('cs_test_3', 'pi_test_3', v_listing2_id, 'buyer@example.com', 1000, null, 'acct_test_2');
  if v_result is distinct from 'recorded' then
    raise exception 'CHECK FAILED: record_paid_order with NULL fee should return recorded, got %', v_result;
  end if;
  select application_fee_cents, seller_email into v_fee, v_email from public.orders where stripe_checkout_session_id = 'cs_test_3';
  if v_fee is distinct from 0 then
    raise exception 'CHECK FAILED: NULL fee should record 0, got %', v_fee;
  end if;
  if v_email is distinct from 'mixed.case@example.com' then
    raise exception 'CHECK FAILED: order seller_email should be lower-cased, got %', v_email;
  end if;

  -- updated_at trigger still fires (it overrides an explicit value).
  update public.listings set updated_at = '2000-01-01' where id = v_listing_id;
  select updated_at into v_ts from public.listings where id = v_listing_id;
  if v_ts < now() - interval '1 minute' then
    raise exception 'CHECK FAILED: updated_at trigger did not fire, got %', v_ts;
  end if;

  reset role;

  -- Privileges and RLS.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_sig in array array[
      'public.reserve_listing(uuid,uuid,integer)',
      'public.attach_hold_session(uuid,uuid,text,text)',
      'public.release_listing_hold(uuid,uuid)',
      'public.record_paid_order(text,text,uuid,text,integer,integer,text)',
      'public.mark_order_refunded(text,text)',
      'public.update_updated_at_column()'
    ] loop
      if has_function_privilege(v_role, v_sig, 'execute') then
        raise exception 'CHECK FAILED: % must not execute %', v_role, v_sig;
      end if;
    end loop;

    foreach v_tbl in array array['public.seller_accounts', 'public.listing_holds', 'public.orders', 'public.checkout_sessions'] loop
      foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
        if has_table_privilege(v_role, v_tbl, v_priv) then
          raise exception 'CHECK FAILED: % must not % on %', v_role, v_priv, v_tbl;
        end if;
      end loop;
    end loop;
  end loop;

  foreach v_sig in array array[
    'public.reserve_listing(uuid,uuid,integer)',
    'public.attach_hold_session(uuid,uuid,text,text)',
    'public.release_listing_hold(uuid,uuid)',
    'public.record_paid_order(text,text,uuid,text,integer,integer,text)',
    'public.mark_order_refunded(text,text)'
  ] loop
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception 'CHECK FAILED: service_role must execute %', v_sig;
    end if;
  end loop;

  if not has_table_privilege('service_role', 'public.messages', 'select') then
    raise exception 'CHECK FAILED: service_role must select on public.messages';
  end if;

  foreach v_tbl in array array['public.seller_accounts', 'public.listing_holds', 'public.orders', 'public.checkout_sessions'] loop
    foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
      if not has_table_privilege('service_role', v_tbl, v_priv) then
        raise exception 'CHECK FAILED: service_role must % on %', v_priv, v_tbl;
      end if;
    end loop;

    if not (select relrowsecurity from pg_class where oid = v_tbl::regclass) then
      raise exception 'CHECK FAILED: row level security must be enabled on %', v_tbl;
    end if;
  end loop;

  select count(*) into v_count from pg_policies
   where schemaname = 'public' and tablename in ('seller_accounts', 'listing_holds', 'orders', 'checkout_sessions');
  if v_count <> 0 then
    raise exception 'CHECK FAILED: new tables must have no RLS policies, found %', v_count;
  end if;

  raise notice 'ALL CHECKS PASSED';
end;
$$;

rollback;

select 'ALL CHECKS PASSED' as result;
