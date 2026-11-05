-- Security hardening and non-destructive attendee exclusion

-- 1. Enable Supabase Realtime publication for entries and draws
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.entries;
    alter publication supabase_realtime add table public.draws;
  end if;
exception when duplicate_object then
  -- Tables already in publication
  null;
end;
$$;

-- 2. Non-destructive exclusion: mark attendee as ineligible for raffle while preserving attendance record
create or replace function public.set_entry_ineligible(p_event_id uuid, p_entry_id uuid, p_ineligible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize with in-flight draws
  perform pg_advisory_xact_lock(('x' || substr(md5(p_event_id::text), 1, 16))::bit(64)::bigint);

  update public.entries
  set ineligible = p_ineligible
  where id = p_entry_id
    and event_id = p_event_id
    and exists (
      select 1
      from public.events
      where id = p_event_id
        and owner_id = auth.uid()
    );

  if not found then
    raise exception 'Entry not found or unauthorized';
  end if;
end;
$$;

-- 3. Explicit confirmed deletion of an attendee record
create or replace function public.delete_entry_record(p_event_id uuid, p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize with in-flight draws
  perform pg_advisory_xact_lock(('x' || substr(md5(p_event_id::text), 1, 16))::bit(64)::bigint);

  delete from public.entries
  where id = p_entry_id
    and event_id = p_event_id
    and exists (
      select 1
      from public.events
      where id = p_event_id
        and owner_id = auth.uid()
    );

  if not found then
    raise exception 'Entry not found or unauthorized';
  end if;
end;
$$;

-- 4. Update clear_event_entries to serialize via advisory lock
create or replace function public.clear_event_entries(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(('x' || substr(md5(p_event_id::text), 1, 16))::bit(64)::bigint);

  if not exists (select 1 from public.events where id = p_event_id and owner_id = auth.uid()) then
    raise exception 'Event not found or unauthorized';
  end if;

  delete from public.entries where event_id = p_event_id;
end;
$$;

-- 5. Revoke default public execution privileges on all functions
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- Grant execution to authenticated hosts
grant execute on function public.create_raffle_event(text) to authenticated;
grant execute on function public.set_event_registration(uuid, boolean) to authenticated;
grant execute on function public.end_raffle_event(uuid) to authenticated;
grant execute on function public.set_entry_ineligible(uuid, uuid, boolean) to authenticated;
grant execute on function public.delete_entry_record(uuid, uuid) to authenticated;
grant execute on function public.remove_entry(uuid, uuid) to authenticated;
grant execute on function public.clear_event_entries(uuid) to authenticated;
grant execute on function public.delete_event_data(uuid) to authenticated;
grant execute on function public.run_event_draw(uuid, uuid, boolean) to authenticated;

-- Grant execution to service_role only for internal helpers
grant execute on function public.apply_rate_limit(uuid, text, integer) to service_role;
