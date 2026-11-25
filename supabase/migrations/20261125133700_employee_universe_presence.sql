create table public.employee_universe_presence (
  employee_id varchar primary key references public.employees(id) on delete cascade,
  last_seen timestamptz not null default now()
);
alter table public.employee_universe_presence enable row level security;
revoke all on public.employee_universe_presence from public, anon, authenticated;
grant select, insert, update on public.employee_universe_presence to service_role;
