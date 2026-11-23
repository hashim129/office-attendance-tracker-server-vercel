create table if not exists public.employee_universe_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  body text not null check (char_length(body) between 1 and 1500),
  mention_ids jsonb not null default '[]'::jsonb,
  reply_to uuid null references public.employee_universe_messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employee_universe_messages_created_at_idx
  on public.employee_universe_messages (created_at desc);

create index if not exists employee_universe_messages_sender_created_idx
  on public.employee_universe_messages (sender_id, created_at desc);

alter table public.employee_universe_messages enable row level security;

revoke all on table public.employee_universe_messages from anon, authenticated;
grant all on table public.employee_universe_messages to service_role;

comment on table public.employee_universe_messages is
  'Employee Universe Beta chat. Access only through session-validated server API; direct client table access is revoked.';
