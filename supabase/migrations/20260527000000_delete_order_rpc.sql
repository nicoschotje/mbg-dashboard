-- delete_order(p_order_id uuid) — owner-only order deletion that restores
-- product stock, writes an activity_log entry, and removes the order row.
-- Dependent rows (mbg_order_enrichments, mbg_discounts, payment_sessions,
-- payment_verifications) are removed via existing ON DELETE CASCADE FKs.
--
-- Adaptations vs. the original spec:
--   * items JSONB uses key "id" (the product uuid), not "product_id" — that is
--     what place_customer_order writes, so stock restore reads "id".
--   * mbg_orders has no order_id / order_number column — it is an unlinked
--     analytics mirror, so the DELETE FROM mbg_orders step is omitted.
--   * activity_log accepts (action, details, created_at); pin_hash is nullable.
--   * is_admin() guard inside the function + EXECUTE granted to anon /
--     authenticated so the dashboard's anon-with-x-admin-secret client can
--     call it. Without this, the dashboard cannot invoke the RPC at all.

CREATE OR REPLACE FUNCTION public.delete_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_item         jsonb;
  v_product_id   uuid;
  v_qty          integer;
  v_items        jsonb;
  v_order_number text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin gateway required' USING ERRCODE = '42501';
  END IF;

  SELECT items, order_number INTO v_items, v_order_number
  FROM public.orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id USING ERRCODE = 'P0001';
  END IF;

  IF v_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      BEGIN
        v_product_id := (v_item->>'id')::uuid;
      EXCEPTION WHEN others THEN
        v_product_id := NULL;
      END;
      v_qty := COALESCE(
        NULLIF(v_item->>'quantity','')::integer,
        NULLIF(v_item->>'qty','')::integer,
        0
      );
      IF v_product_id IS NOT NULL AND v_qty > 0 THEN
        UPDATE public.products
           SET stock_qty = COALESCE(stock_qty, 0) + v_qty,
               updated_at = now()
         WHERE id = v_product_id;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.activity_log (action, details, created_at)
  VALUES (
    'order_deleted',
    jsonb_build_object(
      'order_id', p_order_id,
      'order_number', v_order_number,
      'deleted_at', now()
    ),
    now()
  );

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_order(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
