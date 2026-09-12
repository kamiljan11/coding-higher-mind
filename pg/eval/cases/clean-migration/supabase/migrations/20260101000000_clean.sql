create table customers (id uuid primary key, org_id uuid not null, email text not null);
alter table customers enable row level security;
create policy customers_select on customers for select using (org_id = current_org());
create policy customers_update on customers for update using (org_id = current_org()) with check (org_id = current_org());
create index customers_org_id_idx on customers(org_id);
