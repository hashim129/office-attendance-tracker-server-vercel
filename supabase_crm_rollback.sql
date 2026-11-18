-- Removes ALL CRM data and tables. The attendance app is not affected.
drop table if exists public.crm_inventory_requests;
drop table if exists public.crm_notifications;
drop table if exists public.crm_meetings;
drop table if exists public.crm_followups;
drop table if exists public.crm_customers;

-- Sales coupons (supabase_sales.sql)
drop table if exists public.crm_sales;
drop function if exists public.crm_next_sale_no();
drop sequence if exists public.crm_sale_no_seq;
