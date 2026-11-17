-- CRM v2 (additive; safe to run more than once). Run AFTER supabase_crm.sql.
-- Adds: optional customer details, optional customer + extra employees on follow-ups,
-- the "regular" follow-up type, and inventory requests.

alter table public.crm_customers
  add column if not exists customer_number text not null default '',
  add column if not exists acquired_through text not null default '',
  add column if not exists acquired_by text not null default '';

alter table public.crm_followups alter column customer_id drop not null;
alter table public.crm_followups add column if not exists participant_ids jsonb not null default '[]'::jsonb;
alter table public.crm_followups drop constraint if exists crm_followups_kind_check;
alter table public.crm_followups add constraint crm_followups_kind_check
  check (kind in ('meeting','corporate','internal','regular'));

alter table public.crm_notifications drop constraint if exists crm_notifications_category_check;
alter table public.crm_notifications add constraint crm_notifications_category_check
  check (category in ('followup','meeting','inventory'));

create table if not exists public.crm_inventory_requests (
  id text primary key,
  requested_by text not null,
  assigned_to text not null,                      -- an Accounts or Admin employee
  items jsonb not null default '[]'::jsonb,       -- [{ "item": "Laptop", "qty": 2 }] chosen from the fixed list
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','delivered')),
  decision_remarks text not null default '',
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_inventory_assigned_idx on public.crm_inventory_requests (assigned_to);
alter table public.crm_inventory_requests enable row level security;
