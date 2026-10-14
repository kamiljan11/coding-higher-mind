alter table orders add column f text;
alter table orders alter column a drop not null;
alter table orders drop constraint orders_a_check;
alter table orders add column g text not null default '';
create table fresh (id int);
alter table fresh add column h text not null;
alter table fresh rename column h to h2;
drop table if exists fresh;
