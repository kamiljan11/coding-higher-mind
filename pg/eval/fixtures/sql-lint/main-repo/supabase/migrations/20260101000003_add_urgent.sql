-- R7 positive: kolumna NOT NULL bez DEFAULT dodana do ISTNIEJACEJ tabeli (wiersze juz sa)
alter table public.widgets add column urgent boolean not null;
