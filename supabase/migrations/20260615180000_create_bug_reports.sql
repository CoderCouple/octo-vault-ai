-- Bug-report submissions from /bug-report. Same anon-insert pattern as
-- the waitlist: the anon role can write but never read, so the public
-- JS bundle can submit reports without exposing other users' content.
--
-- This table was missing on production at T-15 — every form submission
-- since the page launched 4xx'd silently into the form's error state.

create table if not exists public.bug_reports (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  title           text        not null,
  description     text        not null,
  steps           text,
  expected        text,
  actual          text,
  email           text,
  screenshot_urls text[],
  user_agent      text,
  app_version     text
);

alter table public.bug_reports enable row level security;

drop policy if exists "anon can insert" on public.bug_reports;
create policy "anon can insert"
  on public.bug_reports for insert
  to anon
  with check (true);
