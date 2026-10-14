drop function if exists public.typed(uuid);
create function public.typed(p text) returns int language sql as $$ select 1 $$;
drop function if exists public.named(uuid, int);
create or replace function public.named(p_org uuid, p_limit int default 10) returns int language sql as $$ select 1 $$;
do $$
begin
  raise notice 'drop table orders';
end $$;
alter table orders drop constraint orders_org_email_uq;
alter table orders add column z serial4 not null;
