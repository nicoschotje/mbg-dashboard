-- discount_codes is an empty, unused placeholder (migration-notes/p1-parity.md:
-- "empty payment/discount placeholders the rebuild won't use"). The live
-- discount mechanism is discount_rules (storefront reads it via its
-- is_active=true policy; dashboard writes via is_admin()). discount_codes still
-- had a public SELECT ... USING (true) policy — the last over-permissive
-- business-data read. Restrict it to is_admin() to match the rest of the
-- business tables. anon has no INSERT here (only is_admin / service_role write)
-- and the table is empty, so this cannot affect the storefront.
--
-- APPLIED TO PRODUCTION 2026-06-08 (version 20260608053217). See DASHBOARD-AUDIT.md P0-3.
DROP POLICY IF EXISTS public_select_discount_codes ON public.discount_codes;
CREATE POLICY discount_codes_admin_read ON public.discount_codes
  FOR SELECT TO public USING (is_admin());
