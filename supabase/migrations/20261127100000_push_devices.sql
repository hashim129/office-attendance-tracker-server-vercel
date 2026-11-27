-- Phones registered for Bahaar Office push notifications (Android app), and which notifications were pushed.
create table if not exists public.push_devices (
  device_key text primary key,
  employee_id text not null,
  fcm_token text,
  platform text not null default 'android',
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_poll_at timestamptz
);
create index if not exists push_devices_employee_idx on public.push_devices (employee_id);
alter table public.push_devices enable row level security;
alter table public.crm_notifications add column if not exists pushed_at timestamptz;
create index if not exists crm_notifications_unpushed_idx on public.crm_notifications (created_at) where pushed_at is null and read_at is null;
