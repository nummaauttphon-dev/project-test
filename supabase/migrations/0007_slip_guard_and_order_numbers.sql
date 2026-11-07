-- Two fixes from the final review.
--
-- 1. transition_order gains p_expected_slip_id: approving or rejecting acts on the slip the admin
--    saw, not on whatever slip is pending when the click arrives.
-- 2. Order numbers keep growing past ORD-999999 instead of being cut to six digits.

-- transition_order is replaced, not overloaded: a second function beside the old one would make
-- PostgREST calls by argument name ambiguous. With p_expected_slip_id null it behaves exactly as
-- in 0005.
drop function public.transition_order(uuid, public.order_status, uuid, text, text, public.order_status);

create function public.transition_order(
  p_order_id uuid,
  p_to public.order_status,
  p_actor uuid,
  p_reason text default null,
  p_tracking_number text default null,
  p_expected_status public.order_status default null,
  p_expected_slip_id uuid default null
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

  -- The caller acted on a page that showed p_expected_status. If the order has moved on since, the
  -- admin decided without seeing the current state (e.g. a refund warning), so nothing changes.
  -- Checked under the row lock, so no competing call can slip in between.
  if p_expected_status is not null and v_from <> p_expected_status then
    return jsonb_build_object('ok', false, 'code', 'STATUS_CHANGED');
  end if;

  -- The caller decided on the slip p_expected_slip_id. If that slip is no longer this order's
  -- pending one (it was reviewed elsewhere and the customer sent another), leaving payment_review
  -- would approve, or attach a reason to, a slip the admin never saw. submit_payment_slip takes the
  -- same row lock, so the pending slip cannot change between this check and the update below.
  if p_expected_slip_id is not null and v_from = 'payment_review' and not exists (
    select 1
    from public.payment_slips as s
    where s.id = p_expected_slip_id and s.order_id = p_order_id and s.review_status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'code', 'STATUS_CHANGED');
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

revoke execute on function public.transition_order(uuid, public.order_status, uuid, text, text, public.order_status, uuid)
  from public, anon, authenticated;
grant execute on function public.transition_order(uuid, public.order_status, uuid, text, text, public.order_status, uuid)
  to service_role;

-- 0001's default, lpad(n, 6), cuts any longer number to six characters: ORD-1000000 would become
-- ORD-100000, collide with an existing order and stop checkout. The width is now at least six and
-- grows with the number. A function, because the default needs the sequence value twice. It runs
-- with the inserting role's rights (service_role inserts orders), like the old default.
create function public.next_order_number() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  n bigint := nextval('public.order_number_seq');
begin
  return 'ORD-' || lpad(n::text, greatest(6, length(n::text)), '0');
end;
$$;

revoke execute on function public.next_order_number() from public, anon, authenticated;
grant execute on function public.next_order_number() to service_role;

alter table public.orders alter column order_number set default public.next_order_number();
