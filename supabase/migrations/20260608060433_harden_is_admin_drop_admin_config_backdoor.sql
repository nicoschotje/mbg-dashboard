-- P0-1 / P0-2 Step C — close the admin master-key backdoor.
--
-- APPLIED TO PRODUCTION 2026-06-08 (versions 20260608060141 then 20260608060433,
-- the second only rewording a comment). This file is the end state.
--
-- Removed the branch that matched x-admin-secret against a separate stored
-- admin-secret hash: that value was the factory-default master key (sha256 of
-- '123456'), it survived every owner PIN change, and it made the Settings
-- PIN-change ineffective. is_admin() now trusts only (1) a valid admin_sessions
-- token (x-admin-token, issued by verify_owner_pin) or (2) x-admin-secret
-- matching the CURRENT dashboard_settings.OWNER_PIN_HASH — so changing the owner
-- PIN now fully rotates admin access.
--
-- PREREQUISITE: the server-side login (js2/core/auth.js using verify_owner_pin /
-- verify_sales_pin, no 123456/1234 fallback) must be LIVE before this runs, or
-- the old client (which logged in with 123456) loses write access. It was
-- deployed via PR #20 before this migration was applied.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_secret text; v_token text; v_hash text; v_stored text; v_token_hash text;
BEGIN
  -- 1) admin session token issued by verify_owner_pin
  BEGIN
    v_token := current_setting('request.headers', true)::json->>'x-admin-token';
  EXCEPTION WHEN OTHERS THEN v_token := NULL; END;
  IF v_token IS NOT NULL AND length(v_token) >= 32 THEN
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');
    PERFORM 1 FROM public.admin_sessions
      WHERE token_hash = v_token_hash AND is_valid = true AND expires_at > now() LIMIT 1;
    IF FOUND THEN RETURN true; END IF;
  END IF;

  -- 2) x-admin-secret must equal the CURRENT owner PIN hash
  BEGIN
    v_secret := current_setting('request.headers', true)::json->>'x-admin-secret';
  EXCEPTION WHEN OTHERS THEN RETURN false; END;
  IF v_secret IS NULL OR v_secret = '' THEN RETURN false; END IF;
  v_hash := encode(digest(v_secret, 'sha256'), 'hex');
  SELECT value INTO v_stored FROM public.dashboard_settings WHERE key = 'OWNER_PIN_HASH' LIMIT 1;
  IF v_stored IS NOT NULL AND v_stored = v_hash THEN RETURN true; END IF;
  RETURN false;
END;
$function$;
