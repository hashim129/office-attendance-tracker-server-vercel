alter table public.employees
  add column if not exists page_access jsonb not null default '{}'::jsonb;

comment on column public.employees.page_access is
  'Super Admin controlled per employee access to application pages.';
