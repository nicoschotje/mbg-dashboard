-- Server-side sales-PIN verification (mirrors verify_owner_pin, no TOTP, no
-- admin session — sales has no admin rights). Lets js2/core/auth.js verify the
-- 4-digit sales PIN without the client ever reading SALES_PIN_HASH (RLS-hidden),
-- which is what allowed the old insecure default-PIN (1234) fallback.
-- See DASHBOARD-AUDIT.md P0-1.

CREATE OR REPLACE FUNCTION public.verify_sales_pin(
  p_pin text,
  p_device_info text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_stored_hash text;
  v_provided_hash text;
BEGIN
  IF p_pin IS NULL OR length(p_pin) <> 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sales PIN must be 4 digits');
  END IF;
  v_provided_hash := encode(digest(p_pin, 'sha256'), 'hex');
  SELECT value INTO v_stored_hash FROM public.dashboard_settings WHERE key = 'SALES_PIN_HASH' LIMIT 1;
  IF v_stored_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No Sales PIN configured');
  END IF;
  IF v_stored_hash <> v_provided_hash THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wrong PIN');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_sales_pin(text, text, text) TO anon, authenticated;
