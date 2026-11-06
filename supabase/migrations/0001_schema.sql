-- Schema, RLS and storage buckets for the web store.
-- Money is stored as integer satang (bigint). All foreign keys use ON DELETE RESTRICT.

create type public.order_status as enum (
  'awaiting_payment', 'payment_review', 'paid', 'shipped', 'expired', 'cancelled'
);
create type public.slip_review_status as enum ('pending', 'approved', 'rejected');

create sequence public.order_number_seq as bigint start 1;

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  price_satang bigint not null check (price_satang >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique
    default ('ORD-' || lpad(nextval('public.order_number_seq')::text, 6, '0')),
  status public.order_status not null default 'awaiting_payment',
  customer_name text not null,
  phone text not null,
  shipping_address text not null,
  subtotal_satang bigint not null check (subtotal_satang >= 0),
  shipping_fee_satang bigint not null check (shipping_fee_satang >= 0),
  total_satang bigint not null check (total_satang >= 0),
  token_hash text not null unique,
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  tracking_number text,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  product_name text not null,
  unit_price_satang bigint not null check (unit_price_satang >= 0),
  quantity integer not null check (quantity > 0)
);

create table public.payment_slips (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  storage_path text not null,
  review_status public.slip_review_status not null default 'pending',
  reject_reason text,
  reviewed_by uuid references auth.users (id) on delete restrict,
  reviewed_at timestamptz,
  file_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reject_reason_required
    check (review_status <> 'rejected' or nullif(btrim(reject_reason), '') is not null)
);

create table public.store_settings (
  id integer primary key default 1 check (id = 1),
  shipping_fee_satang bigint not null check (shipping_fee_satang >= 0),
  payment_window_minutes integer not null check (payment_window_minutes > 0),
  contact_url text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.store_settings (id, shipping_fee_satang, payment_window_minutes, contact_url)
values (1, 5000, 1440, '');

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete restrict
);

create table public.rate_limits (
  key_hash text not null,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (key_hash, action, window_start)
);

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger store_settings_set_updated_at before update on public.store_settings
  for each row execute function public.set_updated_at();

-- Indexes (unique constraints already have their own).
create index orders_status_created_at_idx on public.orders (status, created_at);
create index orders_awaiting_expires_at_idx on public.orders (expires_at)
  where status = 'awaiting_payment';
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);
create index payment_slips_order_id_idx on public.payment_slips (order_id);
create unique index payment_slips_one_pending_per_order_idx
  on public.payment_slips (order_id) where review_status = 'pending';

-- Row Level Security: deny by default.
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_slips enable row level security;
alter table public.store_settings enable row level security;
alter table public.admins enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Objects created later in public are closed to anon/authenticated by default.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- EXECUTE for PUBLIC is a global default, so it must be revoked without IN SCHEMA.
alter default privileges for role postgres revoke execute on functions from public;

grant select on public.products to anon, authenticated;
create policy "Anyone can read active products" on public.products
  for select to anon, authenticated using (is_active);

-- Storage buckets. No policies on storage.objects for anon/authenticated,
-- so only the server (secret key) can write. product-images is readable by public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 4194304,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-slips', 'payment-slips', false, 4194304,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
