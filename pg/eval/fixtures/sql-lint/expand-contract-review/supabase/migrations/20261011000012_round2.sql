drop function if exists public.get_orders(uuid);
create function public.get_orders(p_org uuid, p_limit int) returns setof int language sql as $$ select 1 $$;
drop function if exists public.same_sig(uuid);
create or replace function public.same_sig(p_org uuid) returns int language sql as $$ select 1 $$;
drop view if exists public.va, public.vb;
alter function public.calc(uuid) set schema archive;
alter table orders add column note text default '--', drop column legacy_note;
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'a') then
    alter table orders rename column a to a2;
  end if;
end $$;
alter table orders alter column s drop default, drop constraint orders_org_email_key, drop constraint orders_a_check;
alter table orders add column n2 bigserial not null;
