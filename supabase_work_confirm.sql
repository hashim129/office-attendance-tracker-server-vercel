-- Work confirmation + auto punch-out (unverified time) columns
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS work_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_out_at text,
  ADD COLUMN IF NOT EXISTS unverified_minutes integer NOT NULL DEFAULT 0;
