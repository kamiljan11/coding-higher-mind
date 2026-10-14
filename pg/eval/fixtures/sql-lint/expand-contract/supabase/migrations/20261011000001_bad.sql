alter table orders rename column a to b;
alter table orders drop column c;
alter table orders alter column d set not null;
alter table orders rename to orders_v2;
drop table legacy;
alter table orders add column e text not null;
