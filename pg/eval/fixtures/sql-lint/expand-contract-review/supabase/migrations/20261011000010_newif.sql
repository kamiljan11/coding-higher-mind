create table if not exists brand2 (id int);
alter table brand2 add column x text not null;
alter table brand2 rename column x to y;
