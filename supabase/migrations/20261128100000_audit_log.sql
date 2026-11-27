create table if not exists public.audit_log (
  id text primary key,
  at timestamptz not null default now(),
  actor_id text,
  actor_name text,
  action text not null,
  detail text not null default '',
  ip text
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
