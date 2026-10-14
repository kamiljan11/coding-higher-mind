drop function if exists public.get_orders(uuid);
drop view if exists public.orders_view;
alter function public.calc_total(uuid) rename to calc_total_v2;
drop schema if exists legacy_api cascade;
alter type order_status rename value 'new' to 'created';
drop view if exists public.v2;
create view public.v2 as select 1 as x;
