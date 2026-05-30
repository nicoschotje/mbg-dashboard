-- Per-variant stock. NULL stock_qty = "untracked" (use is_available only).
-- A number = stock-tracked: checkout decrements it, auto sold-out at 0.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS stock_qty integer,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer;
NOTIFY pgrst, 'reload schema';
