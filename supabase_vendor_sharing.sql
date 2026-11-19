-- Vendor payables (second side of Invoices), CRM ID / query code, customer sharing. Already applied to the live project.
alter table public.crm_customers add column if not exists shared_with jsonb not null default '[]'::jsonb;

alter table public.crm_invoices add column if not exists kind text not null default 'customer';
alter table public.crm_invoices drop constraint if exists crm_invoices_kind_check;
alter table public.crm_invoices add constraint crm_invoices_kind_check check (kind in ('customer','vendor'));
alter table public.crm_invoices add column if not exists crm_id text not null default '';
alter table public.crm_invoices add column if not exists query_code text not null default '';

create sequence if not exists public.crm_payable_no_seq start 1;
create or replace function public.crm_next_payable_no() returns text
  language sql security definer set search_path = public as
  $$ select 'PAY-' || lpad(nextval('public.crm_payable_no_seq')::text, 7, '0') $$;
revoke all on function public.crm_next_payable_no() from public, anon, authenticated;
