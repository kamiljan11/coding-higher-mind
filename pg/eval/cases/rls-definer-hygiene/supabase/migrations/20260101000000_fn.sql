create table jobs (id uuid primary key, org_id uuid not null);
alter table jobs enable row level security;
create or replace function get_job_cost(p_job_id uuid) returns numeric language sql security definer as $$
  select 1;
$$;
