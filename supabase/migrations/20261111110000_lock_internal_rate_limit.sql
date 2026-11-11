-- apply_rate_limit is only for the public-submit Edge Function (service role). Supabase's
-- default privileges also granted it to "authenticated", which let any signed-in account
-- call it over /rest/v1/rpc (security advisor 0029). Host RPCs keep their grants: each one
-- checks auth.uid() owns the event.
revoke execute on function public.apply_rate_limit(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.apply_rate_limit(uuid, text, integer) to service_role;

-- Legacy helper superseded by delete_entry_record / set_entry_ineligible; no caller uses it.
revoke execute on function public.remove_entry(uuid, uuid) from public, anon, authenticated;
