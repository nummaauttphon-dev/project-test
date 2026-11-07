-- Admin stock adjustment in one statement, so concurrent adjustments and orders cannot lose an
-- update or push the stock below zero. Callable by the server only (service_role).

create function public.adjust_product_stock(p_product_id uuid, p_delta integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_stock integer;
begin
  -- The condition is evaluated under the row lock the update takes, against the latest committed
  -- stock, and in bigint so the sum itself cannot overflow. integer max is 2147483647.
  update public.products as p
  set stock_quantity = (p.stock_quantity::bigint + p_delta)::integer
  where p.id = p_product_id
    and p.stock_quantity::bigint + p_delta between 0 and 2147483647
  returning p.stock_quantity into v_stock;

  if found then
    return jsonb_build_object('ok', true, 'stock', v_stock);
  end if;

  if not exists (select 1 from public.products as p where p.id = p_product_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if p_delta > 0 then
    return jsonb_build_object('ok', false, 'code', 'STOCK_LIMIT');
  end if;
  return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_STOCK');
end;
$$;

revoke execute on function public.adjust_product_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.adjust_product_stock(uuid, integer) to service_role;
