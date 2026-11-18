-- Invoices + company details + punch-out reminders (additive; safe to run more than once).
-- Already applied to the live project. Run AFTER supabase_sales.sql.

alter table public.crm_notifications drop constraint if exists crm_notifications_category_check;
alter table public.crm_notifications add constraint crm_notifications_category_check
  check (category in ('followup','meeting','inventory','sale','reminder','invoice'));

create sequence if not exists public.crm_invoice_no_seq start 88746;
create or replace function public.crm_next_invoice_no() returns text
  language sql security definer set search_path = public as
  $$ select 'INV-' || lpad(nextval('public.crm_invoice_no_seq')::text, 7, '0') $$;
revoke all on function public.crm_next_invoice_no() from public, anon, authenticated;

create table if not exists public.crm_company (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.crm_company enable row level security;

create table if not exists public.crm_invoices (
  id text primary key,
  invoice_no text not null unique,
  created_by text not null,
  customer_name text not null,
  customer_phone text not null default '',
  customer_address text not null default '',
  customer_ntn text not null default '',
  reference text not null default '',
  invoice_date date not null,
  due_date date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  sections jsonb not null default '[]'::jsonb,
  tax_label text not null default 'Tax',
  tax_rate numeric not null default 0,
  discount numeric not null default 0,
  advance_paid numeric not null default 0,
  subtotal numeric not null default 0,
  tax_amount numeric not null default 0,
  total numeric not null default 0,
  balance numeric not null default 0,
  notes text not null default '',
  status text not null default 'unpaid' check (status in ('unpaid','paid','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_invoices enable row level security;
