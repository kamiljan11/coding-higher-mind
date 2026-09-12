create table public.only_table (
  id uuid primary key default gen_random_uuid(),
  name text
);
alter table public.only_table enable row level security;

create policy "ot_select" on public.only_table
  for select using (auth.uid() is not null);
