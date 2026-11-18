-- Sales coupons + notification history (additive; safe to run more than once). Run AFTER supabase_crm_v2.sql.

alter table public.crm_notifications drop constraint if exists crm_notifications_category_check;
alter table public.crm_notifications add constraint crm_notifications_category_check
  check (category in ('followup','meeting','inventory','sale'));

create sequence if not exists public.crm_sale_no_seq start 1001;
create or replace function public.crm_next_sale_no() returns text
  language sql security definer set search_path = public as
  $$ select 'SC-' || lpad(nextval('public.crm_sale_no_seq')::text, 6, '0') $$;
revoke all on function public.crm_next_sale_no() from public, anon, authenticated;

create table if not exists public.crm_sales (
  id text primary key,
  coupon_no text not null unique,                 -- system generated, e.g. SC-001001
  created_by text not null,                       -- the employee who generated the coupon
  sale_type text not null check (sale_type in ('visa','ticket','hotel','transfers','insurance','others')),
  other_type text not null default '',            -- written by hand when sale_type = 'others'
  customer_name text not null,
  vendor_name text not null,
  package_details text not null,
  pax_name text not null,
  currency text not null,                         -- e.g. PKR, USD, AED
  cost_amount numeric(16,2) not null check (cost_amount >= 0),
  sale_amount numeric(16,2) not null check (sale_amount >= 0),
  query_code text not null,
  psf_profit numeric(16,2) not null,              -- "PSF / Profit" typed by the employee
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
  review_remarks text not null default '',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_sales_created_by_idx on public.crm_sales (created_by);
create index if not exists crm_sales_status_idx on public.crm_sales (status);
alter table public.crm_sales enable row level security;
