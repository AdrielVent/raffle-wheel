alter table public.entries
  add column if not exists hofstra_email text,
  add column if not exists checked_in_at timestamptz not null default now();

alter table public.entries
  add constraint entries_hofstra_email_format_check
  check (
    hofstra_email is null
    or (
      hofstra_email = lower(btrim(hofstra_email))
      and position(' ' in hofstra_email) = 0
      and hofstra_email like '%@hofstra.edu'
    )
  );

create unique index if not exists entries_event_hofstra_email_unique
  on public.entries (event_id, hofstra_email)
  where hofstra_email is not null;
