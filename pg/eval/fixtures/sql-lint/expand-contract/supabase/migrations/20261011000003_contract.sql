-- pg:contract — kolumna c usunieta po pelnym WATCH wydania, ktore przestalo jej uzywac
alter table orders drop column if exists c;
