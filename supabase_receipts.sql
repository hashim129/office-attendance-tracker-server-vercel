-- Receipts (new tab under Sales), vendor details on customer invoices, per-invoice NTN toggle.
-- Additive; safe to run more than once. Run after supabase_vendor_sharing.sql.

alter table public.crm_notifications drop constraint if exists crm_notifications_category_check;
alter table public.crm_notifications add constraint crm_notifications_category_check
  check (category in ('followup','meeting','inventory','sale','reminder','invoice','receipt'));

-- Vendors we pay for a customer invoice (office record only, never printed on the customer's PDF)
alter table public.crm_invoices add column if not exists vendors jsonb not null default '[]'::jsonb;
-- NTN printed on this invoice: null = use the company NTN (older invoices); '' = none. show_ntn = the per-invoice show/hide switch.
alter table public.crm_invoices add column if not exists ntn text;
alter table public.crm_invoices add column if not exists show_ntn boolean not null default true;

create sequence if not exists public.crm_receipt_no_seq start 1;
create or replace function public.crm_next_receipt_no() returns text
  language sql security definer set search_path = public as
  $$ select 'REC-' || lpad(nextval('public.crm_receipt_no_seq')::text, 7, '0') $$;
revoke all on function public.crm_next_receipt_no() from public, anon, authenticated;

create table if not exists public.crm_receipts (
  id text primary key,
  receipt_no text not null unique,
  created_by text not null,
  query_code text not null,
  client_name text not null,
  items jsonb not null default '[]'::jsonb,
  other_item text not null default '',
  payment_type text not null default 'full' check (payment_type in ('full','partial')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_amount numeric not null default 0,
  amount_received numeric not null default 0,
  method text not null default 'cash' check (method in ('cash','bank')),
  bank_name text not null default '',
  reference_no text not null default '',
  proof_image text,
  has_proof boolean not null default false,
  purpose text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_receipts enable row level security;
