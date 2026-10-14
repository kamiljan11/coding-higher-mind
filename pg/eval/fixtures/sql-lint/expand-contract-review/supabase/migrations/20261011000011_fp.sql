alter table orders rename constraint orders_pkey to orders_pk;
alter table orders alter column g drop not null;
alter index orders_pkey rename to orders_pk2;
create or replace function public.maint() returns void language plpgsql as $$
begin
  perform 1; -- drop column x
end $$;
drop function if exists app_private.signup_hook();
alter function private.calc() rename to calc2;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ingest_writer') then
    create role ingest_writer login nobypassrls noinherit;
  end if;
end $$;
