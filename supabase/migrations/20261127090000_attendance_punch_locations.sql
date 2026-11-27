-- Where a phone punch was made (time in / time out), when the admin turned on location checks.
alter table public.attendance add column if not exists punch_locations jsonb;
