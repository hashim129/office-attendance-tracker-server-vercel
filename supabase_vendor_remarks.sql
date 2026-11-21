-- Vendor paid side, follow-up remarks, punch in/out remarks log
ALTER TABLE public.crm_invoices ADD COLUMN IF NOT EXISTS vendor_status text NOT NULL DEFAULT 'unpaid';
ALTER TABLE public.crm_invoices ADD COLUMN IF NOT EXISTS vendor_paid_at timestamptz;
ALTER TABLE public.crm_invoices ADD COLUMN IF NOT EXISTS vendor_paid_by text;
ALTER TABLE public.crm_followups ADD COLUMN IF NOT EXISTS remark_log jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS notes_log jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.attendance
   SET notes_log = jsonb_build_array(jsonb_build_object('at', COALESCE(record_updated_at, now()), 'kind', 'note', 'text', notes))
 WHERE notes IS NOT NULL AND btrim(notes) <> '' AND notes_log = '[]'::jsonb;
