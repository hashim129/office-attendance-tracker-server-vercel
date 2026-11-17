-- Work From Home: each attendance row records whether it was an office shift or a work-from-home shift.
-- (Already applied to the live project as migration "attendance_work_mode".)
alter table public.attendance add column if not exists work_mode text not null default 'office';
alter table public.attendance add column if not exists wfh_reason text;
do $$ begin
  alter table public.attendance add constraint attendance_work_mode_check check (work_mode in ('office','wfh'));
exception when duplicate_object then null; end $$;
-- Rollback:
-- alter table public.attendance drop column work_mode, drop column wfh_reason;
