#!/usr/bin/env node
// Test reguly R16 (granty hurtowe) w sql-migration-lint: lapie ksztalty z blizn RLS-ANON-WRITE i
// GRANT-BULK-UNDOES-REVOKE, nie lapie grantow jawnych. Fikstury buduje w katalogu tymczasowym.
// Uruchom: node bin/test_sql_lint_bulk_grant.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runChecks, SEVERITY, CHECKS } = require(path.join(__dirname, 'sql-migration-lint.js'));

function r16(sql) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-r15-'));
  const dir = path.join(repo, 'supabase', 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '20261115000000_case.sql'), sql);
  return runChecks(repo).findings.filter((f) => f.id === 'R16');
}

// Przypadki blizn.
assert.equal(r16('alter default privileges in schema public grant all on tables to anon, authenticated;').length, 1, 'default privileges: zapis dla anon');
assert.equal(r16('grant execute on all functions in schema public to authenticated;').length, 1, 'execute hurtem cofa jawne revoke');
assert.equal(r16('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;').length, 1, 'zapis na wszystkich tabelach dla anon');
assert.equal(r16('grant all on all tables in schema public to public;').length, 1, 'PUBLIC obejmuje anon: zapis na wszystkich tabelach');
assert.equal(r16('alter default privileges in schema public grant all on tables to public;').length, 1, 'PUBLIC obejmuje anon: default privileges');
assert.equal(r16('grant select on all tables in schema public to public;').length, 0, 'sam odczyt dla PUBLIC');
assert.equal(r16('alter default privileges in schema public grant insert on tables to anon with grant option;').length, 1, 'default privileges z WITH GRANT OPTION');
const loop = `do $$
declare f record;
begin
  for f in select oid::regprocedure as sig from pg_proc where pronamespace = 'public'::regnamespace loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;`;
assert.equal(r16(loop).length, 1, 'grant skladany w petli DO');

// Poprawny kod.
assert.equal(r16('grant execute on function public.top_up_wallet(uuid, numeric) to service_role;').length, 0, 'grant jawny na jedna funkcje');
assert.equal(r16('grant select on all tables in schema public to anon;').length, 0, 'sam odczyt dla anon');
assert.equal(r16('alter default privileges in schema public grant select on tables to anon;').length, 0, 'default privileges: sam odczyt');
assert.equal(r16('grant all on all tables in schema public to service_role;').length, 0, 'rola serwerowa');
assert.equal(r16('revoke execute on all functions in schema public from anon, authenticated;').length, 0, 'revoke hurtem jest bezpieczny');
assert.equal(r16("do $$ begin execute format('alter table %I enable row level security', 'jobs'); end $$;").length, 0, 'DO bez grantu');

// Start bez blokady: MEDIUM nie konczy lintera kodem 1 (blokuje tylko HIGH).
assert.equal(CHECKS.R16.severity, SEVERITY.MEDIUM);

// R17: FK do tabeli najemcy z tabeli bez kolumny org (uogolnienie R9; blizna TENANT-FK-NO-ORG).
function r17(sql) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-r16-'));
  const dir = path.join(repo, 'supabase', 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '20261115000000_case.sql'), sql);
  return runChecks(repo).findings.filter((f) => f.id === 'R17');
}
const vehicles = 'create table vehicles (id uuid primary key, org_id uuid not null);\n';
const leak = r17(vehicles + 'create table vehicle_photos (id uuid primary key, vehicle_id uuid references vehicles(id), url text);');
assert.equal(leak.length, 1, 'dziecko tabeli najemcy bez org_id');
assert.match(leak[0].message, /"vehicle_photos" references tenant-scoped table "vehicles"/);
assert.equal(r17(vehicles + 'create table vehicle_photos (id uuid primary key, org_id uuid not null, vehicle_id uuid references vehicles(id));').length, 0, 'dziecko z org_id');
assert.equal(r17('create table countries (id int primary key);\ncreate table cities (id int primary key, country_id int references countries(id));').length, 0, 'slownik bez najemcy');
assert.equal(r17(vehicles + 'create table vehicle_photos (id uuid primary key, vehicle_id uuid references vehicles(id));\ncreate trigger vehicle_photos_same_org before insert on vehicle_photos for each row execute function check_same_org();').length, 0, 'trigger same_org zamiast kolumny');
assert.equal(r17(vehicles + 'create table vehicle_notes (id uuid primary key, customer_id uuid, vehicle_id uuid references vehicles(id));').length, 0, 'przypadek R9 nie jest zglaszany drugi raz');
assert.equal(CHECKS.R17.severity, SEVERITY.MEDIUM);

console.log('test_sql_lint_bulk_grant: OK (R16, R17)');
