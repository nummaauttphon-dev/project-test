-- Rate limiting and scheduled jobs.

-- Counts one attempt for (key_hash, action) in the current fixed window and returns whether it is
-- within p_limit. One INSERT ... ON CONFLICT statement, so concurrent callers are serialized by the
-- row lock and never over-admit. Refused attempts do not increase the count.
create function public.check_rate_limit(
  p_key_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_counted integer;
begin
  if p_key_hash is null or p_action is null or p_limit is null or p_window_seconds is null
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as r (key_hash, action, window_start, count)
  values (p_key_hash, p_action, v_window_start, 1)
  on conflict (key_hash, action, window_start)
  do update set count = r.count + 1
  where r.count < p_limit
  returning 1 into v_counted;

  return v_counted is not null;
end;
$$;

revoke execute on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;

-- Scheduled jobs run as postgres, which owns the functions and the tables.
create extension if not exists pg_cron;

select cron.schedule('expire-orders', '*/5 * * * *', $$select public.expire_orders()$$);
select cron.schedule(
  'purge-rate-limits',
  '0 3 * * *',
  $$delete from public.rate_limits where window_start < now() - interval '1 day'$$
);
