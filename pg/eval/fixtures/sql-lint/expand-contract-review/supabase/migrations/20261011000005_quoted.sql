create table "public"."brand_new" ("id" uuid not null);
alter table "public"."orders" rename column "b" to "b2";
alter table "public"."orders" add column "z" text not null;
