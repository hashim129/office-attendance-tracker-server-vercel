create table if not exists public.employee_universe_private_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  body text not null check (char_length(body) between 1 and 1500),
  mention_ids jsonb not null check (jsonb_typeof(mention_ids) = 'array' and jsonb_array_length(mention_ids) between 1 and 12),
  reply_to uuid,
  created_at timestamptz not null default now()
);
alter table public.employee_universe_private_messages enable row level security;
revoke all on table public.employee_universe_private_messages from public, anon, authenticated, service_role;
grant select, insert on table public.employee_universe_private_messages to service_role;
create index if not exists universe_private_sender_created_idx on public.employee_universe_private_messages (sender_id, created_at desc);
create index if not exists universe_private_recipients_idx on public.employee_universe_private_messages using gin (mention_ids);
comment on table public.employee_universe_private_messages is 'Private chat messages, accessible only via the session-validated Universe API.';
