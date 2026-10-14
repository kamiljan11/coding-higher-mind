create function public.rpc_named(p_org uuid) returns int language sql as $$ select 1 $$;
create unique index orders_org_email_uidx2 on orders (id);
alter table orders add constraint orders_custom_unq unique (id);
