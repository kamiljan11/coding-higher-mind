create table leads (id uuid primary key, email text);
alter table leads enable row level security;
grant insert, update on leads to anon;
