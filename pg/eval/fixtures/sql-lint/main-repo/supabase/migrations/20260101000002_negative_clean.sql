-- FIXTURE: the same shapes done correctly. None of these should produce findings
-- (other than the always-info R13 where noted).

-- R1 clean: RLS enabled right after create.
create table public.clean_widgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  name text
);
alter table public.clean_widgets enable row level security;

-- R2/R3 clean: WITH CHECK present, write policy scoped to authenticated (not anon/public).
create policy "cw_select" on public.clean_widgets
  for select using (auth.uid() = owner_id);

create policy "cw_update" on public.clean_widgets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "cw_insert" on public.clean_widgets
  for insert to authenticated
  with check (auth.uid() = owner_id);

-- R4/R10/R13 clean: search_path pinned, auth.uid() checked in body, execute locked down.
create or replace function public.safe_fn(id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  update public.clean_widgets
    set name = 'x'
    where clean_widgets.id = safe_fn.id and owner_id = auth.uid();
end;
$$;
revoke execute on function public.safe_fn(uuid) from public;
grant execute on function public.safe_fn(uuid) to authenticated;

-- R5 clean: SELECT-only grant to anon is fine.
grant select on public.clean_widgets to anon;

-- R6 clean: IF EXISTS used.
drop table if exists public.old_clean;
drop policy if exists "cw_select" on public.clean_widgets;

-- R7 clean: nullable column, and NOT NULL with a DEFAULT.
alter table public.clean_widgets add column nickname text;
alter table public.clean_widgets add column urgent2 boolean not null default false;

-- R8 clean: FK column has a matching index (name deliberately distinct from the
-- positive fixture's vendor_id so this fixture set doesn't mask that finding).
create table public.clean_jobs (
  id uuid primary key,
  customer_id uuid references public.customers(id)
);
alter table public.clean_jobs enable row level security;
create index idx_clean_jobs_customer_id on public.clean_jobs (customer_id);

-- R9 clean, path A: tenant column present.
create table public.clean_job_notes (
  id uuid primary key,
  job_id uuid references public.clean_jobs(id),
  org_id uuid not null
);
alter table public.clean_job_notes enable row level security;

-- R9 clean, path B: same_org trigger present instead of a column.
create table public.clean_job_notes2 (
  id uuid primary key,
  job_id uuid references public.clean_jobs(id)
);
alter table public.clean_job_notes2 enable row level security;
create trigger zz_same_org_trg
  before insert on public.clean_job_notes2
  for each row execute function public.check_same_org();

-- R11 clean: USING (true) but table name hints at intentionally public content.
create policy "cp_public" on public.public_catalog
  for select using (true);
