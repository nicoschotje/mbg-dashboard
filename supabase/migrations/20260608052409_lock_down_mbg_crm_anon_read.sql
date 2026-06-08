-- Lock down the MBG customer-CRM tables: anon could read all of them.
--
-- APPLIED TO PRODUCTION 2026-06-08 as migration version 20260608052409
-- (lock_down_mbg_crm_anon_read), directly against the live DB. This file mirrors
-- that change so supabase/migrations/ documents it and a fresh environment ends
-- up in the same state. Idempotent.
--
-- Before: each table had a `SELECT ... USING (true)` policy for public/anon,
-- exposing customer PII (names, phones, spend, behaviour tags) to anyone with
-- the public anon key. After: SELECT requires is_admin(); the dashboard reads
-- these while logged in as owner (is_admin() = true via the x-admin-secret
-- header), the storefront does not use them. See DASHBOARD-AUDIT.md P0-3.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mbg_clients','mbg_client_intelligence','mbg_orders','mbg_order_enrichments',
    'mbg_interactions','mbg_discounts','mbg_tier_history','mbg_import_log'
  ] LOOP
    -- Drop the legacy permissive read (named "Allow anon read <table>" in p1_10).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow anon read ' || t, t);
    -- Recreate the admin-only read (idempotent).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO public USING (is_admin())',
      t || '_admin_read', t);
  END LOOP;
END $$;
