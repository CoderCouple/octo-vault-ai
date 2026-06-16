-- Storage bucket for bug-report screenshots.
--
-- BugReport.uploadScreenshots() POSTs files to
--   /storage/v1/object/bug-screenshots/<name>
-- using the anon key, then references the public URL in the
-- bug_reports.screenshot_urls array.
--
-- Bucket must be public-read so that whoever triages the report can
-- click the URL out of the bug_reports row and see the image without
-- a signed-URL dance. The anon role can INSERT (upload) but not
-- UPDATE/DELETE — once a user submits a screenshot, they can't tamper
-- with it later.

insert into storage.buckets (id, name, public)
values ('bug-screenshots', 'bug-screenshots', true)
on conflict (id) do nothing;

drop policy if exists "anon can upload bug screenshots" on storage.objects;
create policy "anon can upload bug screenshots"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'bug-screenshots');

drop policy if exists "public can read bug screenshots" on storage.objects;
create policy "public can read bug screenshots"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'bug-screenshots');
