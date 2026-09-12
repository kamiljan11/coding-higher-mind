create table jobs (id uuid primary key, org_id uuid not null);
alter table jobs enable row level security;
create table job_notes (id uuid primary key, job_id uuid references jobs(id), body text);
alter table job_notes enable row level security;
create index job_notes_job_id_idx on job_notes(job_id);
