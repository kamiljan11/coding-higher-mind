create table orders (id uuid primary key, a text, c text, d text);
create table legacy (id uuid primary key);
create table scratch (id uuid primary key, x text);
alter table scratch rename column x to y;
alter table scratch rename to scratch2;
