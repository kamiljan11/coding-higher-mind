-- FIXTURE: intentional violations, one per rule (R1-R11,R13). R12 tested in a separate fixture repo.

-- R1: table created, RLS never enabled anywhere in the set.
create table public.widgets (
  id uuid primary key default gen_random_uuid(),
  name text
);

-- R2: FOR UPDATE with USING but no WITH CHECK.
create policy "p1_update" on public.widgets
  for update using (true);

-- R2: FOR INSERT with USING instead of WITH CHECK.
create policy "p2_insert" on public.widgets
  for insert using (true);

-- R3: write policy explicitly granted to anon.
create policy "p3_anon_insert" on public.widgets
  for insert to anon
  with check (true);

-- R4: SECURITY DEFINER, no search_path, never revoked/granted -> two R4 findings.
create or replace function public.do_thing(id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.widgets set name = 'x' where widgets.id = do_thing.id;
end;
$$;

-- R5: GRANT beyond SELECT to anon.
grant insert, update on public.widgets to anon;

-- R6: destructive DDL without IF EXISTS.
drop table public.old_stuff;

-- R6 suppressed: same anti-pattern, but explicitly waived.
-- lint-ignore R6
drop table public.suppressed_drop;

-- R7: ADD COLUMN NOT NULL without DEFAULT.
alter table public.widgets add column urgent boolean not null;

-- R8: FK-shaped column with no matching CREATE INDEX anywhere in the set.
create table public.invoices (
  id uuid primary key,
  vendor_id uuid references public.vendors(id)
);

-- R9: job/note/order/customer FK, no org/tenant column, no same_org trigger.
create table public.job_notes (
  id uuid primary key,
  job_id uuid references public.jobs(id),
  body text
);

-- R10: SECURITY DEFINER RPC with an id param, body has no auth.uid()/org check.
create or replace function public.get_job(job_id uuid)
returns table(id uuid, title text)
language sql
security definer
as $$
  select id, title from public.jobs where id = job_id;
$$;

-- R11: USING (true) on a table whose name gives no public-content hint.
create policy "p4_open" on public.secret_table
  for select using (true);

-- R11 suppressed: same anti-pattern, explicitly waived.
-- lint-ignore R11
create policy "p5_open_waived" on public.weird_table
  for select using (true);
