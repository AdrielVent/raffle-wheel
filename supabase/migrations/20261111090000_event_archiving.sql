-- Event archiving
-- An archived event is ended (no new check-ins, no new draws), hidden from the active list,
-- and keeps all attendance records and draw history.

alter table public.events
  add column if not exists ended_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Backfill: events already ended before this migration get an ended_at.
update public.events
set ended_at = coalesce(ended_at, updated_at)
where status = 'ended' and ended_at is null;

create index if not exists events_owner_active_idx
  on public.events (owner_id, created_at desc)
  where archived_at is null;

-- Ending an event now records when it ended.
create or replace function public.end_raffle_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events
  set status = 'ended',
      registration_open = false,
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where id = p_event_id
    and owner_id = auth.uid();

  if not found then
    raise exception 'Event not found';
  end if;
end;
$$;

-- Registration can't be reopened on an ended or archived event.
create or replace function public.set_event_registration(p_event_id uuid, p_registration_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events
  set
    status = case when p_registration_open then 'open' else 'closed' end,
    registration_open = p_registration_open,
    updated_at = now()
  where id = p_event_id
    and owner_id = auth.uid()
    and status <> 'ended'
    and archived_at is null;

  if not found then
    raise exception 'Event not found, ended, or archived';
  end if;
end;
$$;

create or replace function public.archive_raffle_event(p_event_id uuid, p_archived boolean)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_event public.events;
begin
  -- Serialize with in-flight draws and check-in exclusions for this event
  perform pg_advisory_xact_lock(('x' || substr(md5(p_event_id::text), 1, 16))::bit(64)::bigint);

  if p_archived then
    update public.events
    set status = 'ended',
        registration_open = false,
        ended_at = coalesce(ended_at, now()),
        archived_at = now(),
        updated_at = now()
    where id = p_event_id
      and owner_id = auth.uid()
    returning * into updated_event;
  else
    -- Restoring brings the event back to the list; it stays ended (read-only).
    update public.events
    set archived_at = null,
        updated_at = now()
    where id = p_event_id
      and owner_id = auth.uid()
    returning * into updated_event;
  end if;

  if updated_event.id is null then
    raise exception 'Event not found';
  end if;

  return updated_event;
end;
$$;

revoke execute on function public.archive_raffle_event(uuid, boolean) from public;
revoke execute on function public.archive_raffle_event(uuid, boolean) from anon;
grant execute on function public.archive_raffle_event(uuid, boolean) to authenticated;

-- Re-assert grants for the functions replaced above (create or replace keeps ACLs, but be explicit).
revoke execute on function public.end_raffle_event(uuid) from public, anon;
revoke execute on function public.set_event_registration(uuid, boolean) from public, anon;
grant execute on function public.end_raffle_event(uuid) to authenticated;
grant execute on function public.set_event_registration(uuid, boolean) to authenticated;

-- Hosts get live status changes on the events table too.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.events;
  end if;
exception when duplicate_object then
  null;
end;
$$;
