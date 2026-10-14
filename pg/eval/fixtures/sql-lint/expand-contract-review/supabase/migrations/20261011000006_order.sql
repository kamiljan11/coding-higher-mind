create table if not exists orders (id uuid primary key);
alter table orders alter column d set not null;
alter table late_t drop column k;
create table late_t (id int);
