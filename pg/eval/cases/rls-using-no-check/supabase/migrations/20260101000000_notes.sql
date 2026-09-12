create table notes (id uuid primary key, org_id uuid not null, body text);
alter table notes enable row level security;
create policy notes_update on notes for update using (org_id = current_org());
