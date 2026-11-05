create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  status text not null default 'open' check (status in ('open', 'closed', 'ended')),
  registration_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  submission_id uuid not null,
  retry_receipt uuid not null,
  ineligible boolean not null default false,
  created_at timestamptz not null default now(),
  unique(event_id, submission_id)
);

create table if not exists public.draws (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  request_id uuid not null,
  winner_entry_id uuid references public.entries(id) on delete set null,
  winner_first_name text,
  winner_last_name text,
  snapshot jsonb not null,
  snapshot_size integer not null,
  remove_winner boolean not null,
  created_at timestamptz not null default now(),
  unique(event_id, request_id)
);

create table if not exists public.rate_limit_windows (
  id bigserial primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  fingerprint_hash text not null,
  window_start timestamptz not null,
  attempts integer not null default 0,
  unique(event_id, fingerprint_hash, window_start)
);

alter table public.events enable row level security;
alter table public.entries enable row level security;
alter table public.draws enable row level security;
alter table public.rate_limit_windows enable row level security;

create policy "owners can manage events" on public.events
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "owners can read entries" on public.entries
for select
using (
  exists (
    select 1
    from public.events
    where events.id = entries.event_id
      and events.owner_id = auth.uid()
  )
);

create policy "owners can update entries" on public.entries
for update
using (
  exists (
    select 1
    from public.events
    where events.id = entries.event_id
      and events.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.events
    where events.id = entries.event_id
      and events.owner_id = auth.uid()
  )
);

create policy "owners can delete entries" on public.entries
for delete
using (
  exists (
    select 1
    from public.events
    where events.id = entries.event_id
      and events.owner_id = auth.uid()
  )
);

create policy "owners can read draws" on public.draws
for select
using (
  exists (
    select 1
    from public.events
    where events.id = draws.event_id
      and events.owner_id = auth.uid()
  )
);

create or replace function public.generate_event_slug()
returns text
language plpgsql
as $$
declare
  generated text;
begin
  generated := lower(encode(gen_random_bytes(6), 'hex'));
  return generated;
end;
$$;

create or replace function public.create_raffle_event(p_name text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  created_event public.events;
  candidate_slug text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  if btrim(p_name) = '' then
    raise exception 'Event name is required';
  end if;

  loop
    candidate_slug := public.generate_event_slug();
    begin
      insert into public.events (owner_id, name, slug)
      values (auth.uid(), btrim(p_name), candidate_slug)
      returning * into created_event;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  return created_event;
end;
$$;

create or replace function public.set_event_registration(p_event_id uuid, p_registration_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events
  set
    status = case when status = 'ended' then status when p_registration_open then 'open' else 'closed' end,
    registration_open = p_registration_open,
    updated_at = now()
  where id = p_event_id
    and owner_id = auth.uid();

  if not found then
    raise exception 'Event not found';
  end if;
end;
$$;

create or replace function public.end_raffle_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events
  set status = 'ended', registration_open = false, updated_at = now()
  where id = p_event_id
    and owner_id = auth.uid();

  if not found then
    raise exception 'Event not found';
  end if;
end;
$$;

create or replace function public.remove_entry(p_event_id uuid, p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
    raise exception 'Entry not found';
  end if;
end;
$$;

create or replace function public.clear_event_entries(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.events where id = p_event_id and owner_id = auth.uid()) then
    raise exception 'Event not found';
  end if;

  delete from public.entries where event_id = p_event_id;
end;
$$;

create or replace function public.delete_event_data(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.events
  where id = p_event_id
    and owner_id = auth.uid();

  if not found then
    raise exception 'Event not found';
  end if;
end;
$$;

create or replace function public.random_uniform_index(p_count integer)
returns integer
language plpgsql
as $$
declare
  max_u64 numeric := 18446744073709551616;
  limit_value numeric;
  candidate numeric;
begin
  if p_count <= 0 then
    raise exception 'Count must be positive';
  end if;

  limit_value := floor(max_u64 / p_count) * p_count;

  loop
    candidate := ('x' || encode(gen_random_bytes(8), 'hex'))::bit(64)::numeric;
    if candidate < limit_value then
      return (candidate % p_count)::integer;
    end if;
  end loop;
end;
$$;

create or replace function public.run_event_draw(p_event_id uuid, p_request_id uuid, p_remove_winner boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_match boolean;
  existing_draw public.draws;
  eligible_snapshot jsonb;
  snapshot_count integer;
  winner_offset integer;
  winner_id uuid;
  winner_first text;
  winner_last text;
  created_draw public.draws;
  event_status text;
begin
  select (owner_id = auth.uid()), status into owner_match, event_status
  from public.events
  where id = p_event_id;

  if not coalesce(owner_match, false) then
    raise exception 'Unauthorized';
  end if;

  perform pg_advisory_xact_lock(('x' || substr(md5(p_event_id::text), 1, 16))::bit(64)::bigint);

  select * into existing_draw
  from public.draws
  where event_id = p_event_id and request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'draw_id', existing_draw.id,
      'winner_entry_id', existing_draw.winner_entry_id,
      'winner_first_name', existing_draw.winner_first_name,
      'winner_last_name', existing_draw.winner_last_name,
      'snapshot', existing_draw.snapshot,
      'snapshot_size', existing_draw.snapshot_size
    );
  end if;

  if event_status = 'ended' then
    return jsonb_build_object('status', 'ended');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'first_name', first_name,
      'last_name', last_name,
      'ineligible', ineligible,
      'created_at', created_at
    ) order by created_at), '[]'::jsonb),
    count(*)::integer
  into eligible_snapshot, snapshot_count
  from public.entries
  where event_id = p_event_id
    and ineligible = false;

  if snapshot_count = 0 then
    insert into public.draws (
      event_id,
      request_id,
      winner_entry_id,
      winner_first_name,
      winner_last_name,
      snapshot,
      snapshot_size,
      remove_winner
    )
    values (
      p_event_id,
      p_request_id,
      null,
      null,
      null,
      eligible_snapshot,
      snapshot_count,
      p_remove_winner
    )
    returning * into created_draw;

    return jsonb_build_object(
      'status', 'empty',
      'draw_id', created_draw.id,
      'snapshot', created_draw.snapshot,
      'snapshot_size', created_draw.snapshot_size
    );
  end if;

  winner_offset := public.random_uniform_index(snapshot_count);

  select
    (winner_entry->>'id')::uuid,
    winner_entry->>'first_name',
    winner_entry->>'last_name'
  into winner_id, winner_first, winner_last
  from jsonb_array_elements(eligible_snapshot) with ordinality as selected(winner_entry, idx)
  where (idx - 1) = winner_offset;

  insert into public.draws (
    event_id,
    request_id,
    winner_entry_id,
    winner_first_name,
    winner_last_name,
    snapshot,
    snapshot_size,
    remove_winner
  )
  values (
    p_event_id,
    p_request_id,
    winner_id,
    winner_first,
    winner_last,
    eligible_snapshot,
    snapshot_count,
    p_remove_winner
  )
  returning * into created_draw;

  if p_remove_winner then
    update public.entries
    set ineligible = true
    where id = winner_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'draw_id', created_draw.id,
    'winner_entry_id', winner_id,
    'winner_first_name', winner_first,
    'winner_last_name', winner_last,
    'snapshot', created_draw.snapshot,
    'snapshot_size', created_draw.snapshot_size
  );
end;
$$;

create or replace function public.apply_rate_limit(p_event_id uuid, p_fingerprint_hash text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz := date_trunc('minute', now());
  attempt_count integer;
begin
  insert into public.rate_limit_windows (event_id, fingerprint_hash, window_start, attempts)
  values (p_event_id, p_fingerprint_hash, current_window, 1)
  on conflict (event_id, fingerprint_hash, window_start)
  do update set attempts = public.rate_limit_windows.attempts + 1
  returning attempts into attempt_count;

  return attempt_count <= p_limit;
end;
$$;

grant execute on function public.create_raffle_event(text) to authenticated;
grant execute on function public.set_event_registration(uuid, boolean) to authenticated;
grant execute on function public.end_raffle_event(uuid) to authenticated;
grant execute on function public.remove_entry(uuid, uuid) to authenticated;
grant execute on function public.clear_event_entries(uuid) to authenticated;
grant execute on function public.delete_event_data(uuid) to authenticated;
grant execute on function public.run_event_draw(uuid, uuid, boolean) to authenticated;
grant execute on function public.apply_rate_limit(uuid, text, integer) to service_role;

grant select on public.events to authenticated;
grant select on public.entries to authenticated;
grant select on public.draws to authenticated;
