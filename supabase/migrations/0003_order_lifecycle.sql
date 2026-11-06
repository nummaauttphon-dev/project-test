-- Order lifecycle: payment slips, status transitions, expiry and stock restoration.
-- Every function locks the order row before reading its status, so of two competing calls the
-- second sees the first one's result. Relies on READ COMMITTED, as create_order does.
--
-- Lock order: order rows, then product rows in id order. create_order also takes products in id
-- order, and expire_orders never waits on an order row, so these cannot deadlock.

-- Trims all whitespace, unlike btrim's default. Blank input becomes null.
create function public.trim_to_null(p_value text) returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(p_value, '^\s+|\s+$', '', 'g'), '');
$$;

revoke execute on function public.trim_to_null(text) from public, anon, authenticated;
grant execute on function public.trim_to_null(text) to service_role;

-- Returns the stock of the given orders. The caller must hold their row locks and must move them
-- to a terminal status in the same transaction, which is what makes this happen only once.
-- Takes all orders at once: restocking them one by one could lock products out of id order.
create function public.restock_orders(p_order_ids uuid[]) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.products as p
  where p.id in (
    select i.product_id from public.order_items as i where i.order_id = any (p_order_ids)
  )
  order by p.id
  for update;

  -- Summed first: UPDATE ... FROM applies only one joined row per product.
  update public.products as p
  set stock_quantity = p.stock_quantity + m.quantity
  from (
    select i.product_id, sum(i.quantity)::integer as quantity
    from public.order_items as i
    where i.order_id = any (p_order_ids)
    group by i.product_id
  ) as m
  where p.id = m.product_id;
end;
$$;

revoke execute on function public.restock_orders(uuid[]) from public, anon, authenticated;
grant execute on function public.restock_orders(uuid[]) to service_role;

create function public.submit_payment_slip(p_order_id uuid, p_storage_path text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_expires_at timestamptz;
begin
  select o.status, o.expires_at
  into v_status, v_expires_at
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- The customer gets the same answer whether or not cron has run yet. Past the deadline this
  -- only refuses: changing status and restocking stay with expire_orders.
  if v_status = 'expired' or (v_status = 'awaiting_payment' and v_expires_at <= now()) then
    return jsonb_build_object('ok', false, 'code', 'EXPIRED');
  end if;

  if v_status <> 'awaiting_payment' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  insert into public.payment_slips (order_id, storage_path)
  values (p_order_id, p_storage_path);

  update public.orders
  set status = 'payment_review'
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'status', 'payment_review');
end;
$$;

revoke execute on function public.submit_payment_slip(uuid, text) from public, anon, authenticated;
grant execute on function public.submit_payment_slip(uuid, text) to service_role;

create function public.transition_order(
  p_order_id uuid,
  p_to public.order_status,
  p_actor uuid,
  p_reason text default null,
  p_tracking_number text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_from public.order_status;
  v_reason text := public.trim_to_null(p_reason);
  v_tracking text := public.trim_to_null(p_tracking_number);
  v_window integer;
begin
  select o.status
  into v_from
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- The status table of the design spec, section 3, except for payment_review and expired, which
  -- only submit_payment_slip and expire_orders may enter. "is not true": p_to may be null.
  if ((v_from, p_to) in (
    ('awaiting_payment', 'cancelled'),
    ('payment_review', 'paid'),
    ('payment_review', 'awaiting_payment'),
    ('payment_review', 'cancelled'),
    ('paid', 'shipped'),
    ('paid', 'cancelled')
  )) is not true then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION');
  end if;

  -- An order is never paid without a slip to review. The order lock keeps this true until the
  -- update below, since submit_payment_slip takes the same lock.
  if p_to = 'paid' and not exists (
    select 1
    from public.payment_slips as s
    where s.order_id = p_order_id and s.review_status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION');
  end if;

  if v_from = 'payment_review' and p_to = 'awaiting_payment' and v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  if p_to = 'shipped' and v_tracking is null then
    return jsonb_build_object('ok', false, 'code', 'TRACKING_REQUIRED');
  end if;

  -- Every way out of payment_review reviews the pending slip. Like create_order's malformed
  -- input, a missing actor is a server bug rather than a user condition, so it raises.
  if v_from = 'payment_review' then
    if p_actor is null then
      raise exception 'transition_order: p_actor is required to review a slip'
        using errcode = 'invalid_parameter_value';
    end if;

    if p_to = 'paid' then
      update public.payment_slips
      set review_status = 'approved', reviewed_by = p_actor, reviewed_at = now()
      where order_id = p_order_id and review_status = 'pending';
    else
      -- Cancelling needs no reason from the admin, but a rejected slip must have one.
      update public.payment_slips
      set review_status = 'rejected',
          reject_reason = coalesce(v_reason, 'ออเดอร์ถูกยกเลิก'),
          reviewed_by = p_actor,
          reviewed_at = now()
      where order_id = p_order_id and review_status = 'pending';
    end if;
  end if;

  if p_to = 'cancelled' then
    perform public.restock_orders(array[p_order_id]);
  end if;

  if p_to = 'awaiting_payment' then
    select s.payment_window_minutes
    into strict v_window
    from public.store_settings as s
    where s.id = 1;
  end if;

  -- The table has no way out of a terminal status, so terminal_at can only be set once.
  update public.orders as o
  set status = p_to,
      expires_at = case
        when p_to = 'awaiting_payment' then now() + make_interval(mins => v_window)
        else o.expires_at
      end,
      tracking_number = case when p_to = 'shipped' then v_tracking else o.tracking_number end,
      terminal_at = case
        when p_to in ('shipped', 'cancelled') then now()
        else o.terminal_at
      end
  where o.id = p_order_id;

  return jsonb_build_object('ok', true, 'status', p_to);
end;
$$;

revoke execute on function public.transition_order(uuid, public.order_status, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_order(uuid, public.order_status, uuid, text, text)
  to service_role;

-- Corrects a tracking number after shipping. Changes nothing else: terminal_at keeps counting
-- the slip retention period from when the order actually shipped.
create function public.set_tracking_number(p_order_id uuid, p_tracking_number text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_tracking text := public.trim_to_null(p_tracking_number);
begin
  select o.status
  into v_status
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_status <> 'shipped' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  if v_tracking is null then
    return jsonb_build_object('ok', false, 'code', 'TRACKING_REQUIRED');
  end if;

  update public.orders
  set tracking_number = v_tracking
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke execute on function public.set_tracking_number(uuid, text) from public, anon, authenticated;
grant execute on function public.set_tracking_number(uuid, text) to service_role;

-- Safe to call repeatedly or concurrently. Skipped rows are busy with another call, which either
-- settles them or leaves them for the next run. The status re-check under the lock excludes
-- anything a competing transaction has already moved on.
create function public.expire_orders() returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(d.id), '{}')
  into v_ids
  from (
    select o.id
    from public.orders as o
    where o.status = 'awaiting_payment' and o.expires_at <= now()
    for update skip locked
  ) as d;

  perform public.restock_orders(v_ids);

  update public.orders
  set status = 'expired', terminal_at = now()
  where id = any (v_ids);

  return cardinality(v_ids);
end;
$$;

revoke execute on function public.expire_orders() from public, anon, authenticated;
grant execute on function public.expire_orders() to service_role;
