-- On Supabase, pgcrypto lives in the "extensions" schema. The slug generator and the
-- unbiased random index helper call gen_random_bytes(); when invoked from the
-- security-definer RPCs (search_path = public) they could not find it, which broke
-- "Create Event" and every raffle draw. Pin an explicit search_path that includes
-- extensions (also clears the "function_search_path_mutable" security advisory).

create or replace function public.generate_event_slug()
returns text
language plpgsql
set search_path = public, extensions
as $$
begin
  return lower(encode(extensions.gen_random_bytes(6), 'hex'));
end;
$$;

create or replace function public.random_uniform_index(p_count integer)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  max_u64 numeric := 18446744073709551616;
  limit_value numeric;
  candidate numeric;
begin
  if p_count <= 0 then
    raise exception 'Count must be positive';
  end if;

  -- Rejection sampling: discard the biased tail so every index is equally likely
  limit_value := floor(max_u64 / p_count) * p_count;

  loop
    candidate := ('x' || encode(extensions.gen_random_bytes(8), 'hex'))::bit(64)::bigint::numeric;
    if candidate < 0 then
      candidate := candidate + max_u64;
    end if;
    if candidate < limit_value then
      return (candidate % p_count)::integer;
    end if;
  end loop;
end;
$$;

-- Internal helpers: callable only from the security-definer RPCs, never directly.
revoke execute on function public.generate_event_slug() from public, anon, authenticated;
revoke execute on function public.random_uniform_index(integer) from public, anon, authenticated;
