-- CRM tables (travel agency). Independent of the attendance tables; safe to run more than once.
-- To remove the CRM completely, run supabase_crm_rollback.sql.

create table if not exists public.crm_customers (
  id text primary key,
  customer_name text not null,
  company_name text not null default '',
  destinations jsonb not null default '[]'::jsonb,   -- typed manually, e.g. "Istanbul, Turkey"
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.crm_followups (
  id text primary key,
  customer_id text not null,
  kind text not null check (kind in ('meeting','corporate','internal')),
  assigned_to text not null,
  remarks text not null default '',
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending','completed','not_completed','rescheduled')),
  outcome_remarks text not null default '',
  history jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.crm_meetings (
  id text primary key,
  title text not null,
  customer_id text,
  external_name text not null default '',
  attendee_ids jsonb not null default '[]'::jsonb,
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text not null default '',
  notes text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled','pending_approval','rejected','cancelled','completed')),
  requested_by text,
  decided_by text,
  decision_note text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_notifications (
  id text primary key,
  employee_id text not null,
  category text not null check (category in ('followup','meeting')),
  ref_id text,
  message text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists crm_followups_assigned_idx on public.crm_followups (assigned_to);
create index if not exists crm_meetings_start_idx on public.crm_meetings (start_at);
create index if not exists crm_notifications_emp_idx on public.crm_notifications (employee_id);

-- Same lock-down as the other tables: only the server (secret key) can read or write.
alter table public.crm_customers enable row level security;
alter table public.crm_followups enable row level security;
alter table public.crm_meetings enable row level security;
alter table public.crm_notifications enable row level security;
