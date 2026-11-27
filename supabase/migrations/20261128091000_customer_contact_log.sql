alter table public.crm_customers add column if not exists contact_log jsonb not null default '[]'::jsonb;
