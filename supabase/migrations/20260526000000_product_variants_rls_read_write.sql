-- Canonical RLS for product_variants (Phase 2 variants).
--
-- Bug: the variant manager showed "No variants yet" for products that have
-- variants, and variant add/edit/delete/reorder silently did nothing. Root
-- cause was RLS on product_variants, not the dashboard code:
--   * reads were not guaranteed open to the anon role the dashboard uses, and
--   * there was no write policy for the dashboard's is_admin() gateway
--     (the x-admin-secret / owner-PIN mechanism), so every write affected
--     0 rows.
--
-- Fix mirrors the products table: public read for listing, writes gated by
-- is_admin(). Applied atomically so there is no window where reads are blocked.

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read product_variants" ON public.product_variants;
CREATE POLICY "Public read product_variants"
  ON public.product_variants
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "product_variants_admin_write" ON public.product_variants;
CREATE POLICY "product_variants_admin_write"
  ON public.product_variants
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin());

NOTIFY pgrst, 'reload schema';
