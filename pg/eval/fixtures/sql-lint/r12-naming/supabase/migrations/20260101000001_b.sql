-- R12: duplicate 14-digit timestamp prefix vs 20260101000001_a.sql
create table public.b (id uuid primary key);
alter table public.b enable row level security;
