-- Atomic order creation: computes totals from locked rows, reserves stock and writes the order
-- in one transaction. Relies on READ COMMITTED and VOLATILE, so each statement sees a fresh
-- snapshot; the re-checks below depend on that.

create function public.create_order(
  p_idempotency_key text,
  p_token_hash text,
  p_customer_name text,
  p_phone text,
  p_shipping_address text,
  p_items jsonb,
  p_expected_total_satang bigint
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_product_ids uuid[];
  v_quantities integer[];
  v_line record;
  v_order_id uuid;
  v_order_number text;
  v_shipping_fee bigint;
  v_payment_window integer;
  v_subtotal bigint := 0;  -- purchasable lines only: current price x available quantity
  v_stock_changes jsonb := '[]'::jsonb;
  v_price_changes jsonb := '[]'::jsonb;
begin
  -- Malformed input is a server bug, not a customer condition, so it raises.
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order: p_items must be a non-empty array'
      using errcode = 'invalid_parameter_value';
  end if;

  -- "is not true": on a non-object element or a missing key the checks yield NULL.
  if exists (
    select 1
    from jsonb_array_elements(p_items) as e
    where (
      jsonb_typeof(e -> 'product_id') = 'string'
      and e ->> 'product_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and jsonb_typeof(e -> 'quantity') = 'number'
      and e ->> 'quantity' ~ '^([1-9]|10)$'
    ) is not true
  ) then
    raise exception 'create_order: each item needs a uuid product_id and an integer quantity from 1 to 10'
      using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(m.product_id order by m.product_id),
         array_agg(m.quantity order by m.product_id)
  into v_product_ids, v_quantities
  from (
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as e
    group by 1
  ) as m;

  -- Duplicate lines become one order item, so the per-item limit applies after merging too.
  if 10 < any (v_quantities) then
    raise exception 'create_order: merged quantity for a product exceeds 10'
      using errcode = 'invalid_parameter_value';
  end if;

  select o.id, o.order_number into v_order_id, v_order_number
  from public.orders as o
  where o.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'existing', 'order_id', v_order_id, 'order_number', v_order_number);
  end if;

  -- Lock in id order so that carts listing the same products cannot deadlock.
  perform 1
  from public.products as p
  where p.id = any (v_product_ids)
  order by p.id
  for update;

  -- A same-key request may have held these locks while we waited. Without this re-check we would
  -- see the stock it took and report a stock problem instead of its order.
  select o.id, o.order_number into v_order_id, v_order_number
  from public.orders as o
  where o.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'existing', 'order_id', v_order_id, 'order_number', v_order_number);
  end if;

  select s.shipping_fee_satang, s.payment_window_minutes
  into strict v_shipping_fee, v_payment_window
  from public.store_settings as s
  where s.id = 1;

  -- Reads below see the locked rows' current values.
  for v_line in
    select m.product_id, m.quantity, p.price_satang, p.stock_quantity, p.is_active
    from unnest(v_product_ids, v_quantities) as m (product_id, quantity)
    left join public.products as p on p.id = m.product_id
    order by m.product_id
  loop
    if v_line.is_active is not true then  -- hidden, or no such product (price stays null)
      v_stock_changes := v_stock_changes || jsonb_build_object(
        'product_id', v_line.product_id,
        'reason', 'unavailable',
        'available_quantity', 0,
        'current_price_satang', v_line.price_satang
      );
    else
      if v_line.stock_quantity < v_line.quantity then
        v_stock_changes := v_stock_changes || jsonb_build_object(
          'product_id', v_line.product_id,
          'reason', 'insufficient_stock',
          'available_quantity', v_line.stock_quantity,
          'current_price_satang', v_line.price_satang
        );
      end if;
      v_subtotal := v_subtotal + v_line.price_satang * least(v_line.quantity, v_line.stock_quantity);
      v_price_changes := v_price_changes || jsonb_build_object(
        'product_id', v_line.product_id,
        'reason', 'price_changed',
        'available_quantity', v_line.stock_quantity,
        'current_price_satang', v_line.price_satang
      );
    end if;
  end loop;

  if jsonb_array_length(v_stock_changes) > 0 then
    return jsonb_build_object(
      'status', 'changed',
      'changes', v_stock_changes,
      'current_total_satang', v_subtotal + v_shipping_fee
    );
  end if;

  -- "is distinct from": a null expectation must not count as a match.
  -- The client sends no per-line price, so a mismatch is reported on every line.
  if v_subtotal + v_shipping_fee is distinct from p_expected_total_satang then
    return jsonb_build_object(
      'status', 'changed',
      'changes', v_price_changes,
      'current_total_satang', v_subtotal + v_shipping_fee
    );
  end if;

  begin
    insert into public.orders (
      customer_name, phone, shipping_address,
      subtotal_satang, shipping_fee_satang, total_satang,
      token_hash, idempotency_key, expires_at
    ) values (
      p_customer_name, p_phone, p_shipping_address,
      v_subtotal, v_shipping_fee, v_subtotal + v_shipping_fee,
      p_token_hash, p_idempotency_key, now() + make_interval(mins => v_payment_window)
    )
    returning id, order_number into v_order_id, v_order_number;

    insert into public.order_items (order_id, product_id, product_name, unit_price_satang, quantity)
    select v_order_id, p.id, p.name, p.price_satang, m.quantity
    from unnest(v_product_ids, v_quantities) as m (product_id, quantity)
    join public.products as p on p.id = m.product_id;

    update public.products as p
    set stock_quantity = p.stock_quantity - m.quantity
    from unnest(v_product_ids, v_quantities) as m (product_id, quantity)
    where p.id = m.product_id;
  exception
    when unique_violation then
      -- A same-key request on other products can get past both lookups. Any other unique
      -- violation (token_hash) is not an idempotent retry, so it propagates.
      select o.id, o.order_number into v_order_id, v_order_number
      from public.orders as o
      where o.idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('status', 'existing', 'order_id', v_order_id, 'order_number', v_order_number);
      end if;
      raise;
  end;

  return jsonb_build_object('status', 'created', 'order_id', v_order_id, 'order_number', v_order_number);
end;
$$;

revoke execute on function public.create_order(text, text, text, text, text, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.create_order(text, text, text, text, text, jsonb, bigint)
  to service_role;
