drop index if exists orders_same_uidx;
create unique index orders_same_uidx on orders ("id");
drop index if exists orders_diff_uidx;
create unique index orders_diff_uidx on orders (id, s);
