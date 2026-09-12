-- R12: filename has no 14-digit timestamp prefix.
create table public.x (id uuid primary key);
alter table public.x enable row level security;
