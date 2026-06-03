-- Waitlist table for the landing site. The anon (browser) role can only
-- INSERT — RLS forbids SELECT/UPDATE/DELETE, so even though the anon key
-- ships in the JS bundle, nobody can read other people's emails with it.

create table if not exists public.waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  source     text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

drop policy if exists "anon can insert" on public.waitlist;
create policy "anon can insert"
  on public.waitlist for insert
  to anon
  with check (true);
