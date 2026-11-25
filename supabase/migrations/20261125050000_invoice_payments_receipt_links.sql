-- Invoice payment history (several payments received at different times) and receipt -> invoice links.
-- Purely additive: existing rows keep working (payments defaults to an empty list; advance_paid stays the running total).
alter table public.crm_invoices add column if not exists payments jsonb not null default '[]'::jsonb;
alter table public.crm_receipts add column if not exists linked_invoice_id text;
create index if not exists crm_receipts_linked_invoice_idx on public.crm_receipts (linked_invoice_id);
