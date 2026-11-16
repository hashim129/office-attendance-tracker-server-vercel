-- Removes ALL CRM data and tables. The attendance app is not affected.
drop table if exists public.crm_notifications;
drop table if exists public.crm_meetings;
drop table if exists public.crm_followups;
drop table if exists public.crm_customers;
