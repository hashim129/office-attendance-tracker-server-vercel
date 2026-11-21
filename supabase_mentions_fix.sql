-- Already applied to the live database (migration "mentions_personal_customer_notifs").
ALTER TABLE public.ceo_comments
  ADD COLUMN IF NOT EXISTS employee_name varchar,
  ADD COLUMN IF NOT EXISTS from_role varchar,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_followups DROP CONSTRAINT IF EXISTS crm_followups_kind_check;
ALTER TABLE public.crm_followups ADD CONSTRAINT crm_followups_kind_check
  CHECK (kind = ANY (ARRAY['meeting','corporate','internal','regular','personal']));
ALTER TABLE public.crm_notifications DROP CONSTRAINT IF EXISTS crm_notifications_category_check;
ALTER TABLE public.crm_notifications ADD CONSTRAINT crm_notifications_category_check
  CHECK (category = ANY (ARRAY['followup','meeting','inventory','sale','reminder','invoice','receipt','customer']));
UPDATE public.crm_notifications SET category = 'customer'
  WHERE category = 'followup' AND message LIKE 'New Customer Portal Quote Request%';
