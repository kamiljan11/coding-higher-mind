#!/usr/bin/env node
// Bramka audytu zaleznosci w CI: blokuje kazda podatnosc high/critical, poza swiadomymi wyjatkami z data wygasniecia.
// Wejscie: JSON z `npm audit --json` albo `pnpm audit --json` (sciezka w argv[2]); wyjatki w env AUDIT_ALLOW
// jako "GHSA-xxxx:RRRR-MM-DD[,GHSA-yyyy:RRRR-MM-DD]". Po dacie wyjatek przestaje dzialac i podatnosc znowu blokuje.
// Brak albo uszkodzony JSON, blad audytu = fail-closed (exit 1). Wprowadzone 2026-10-05: braces 3.0.4 (poprawka
// GHSA-vfj7-8cjw-p6xm) nie istnieje w rejestrze npm, a `npm audit --audit-level=high` blokowal cala flote.
import fs from "node:fs";

const BLOKUJACE = new Set(["high", "critical"]);

function wyjatki(tekst) {
  return new Map(
    String(tekst || "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((wpis) => wpis.split(":")),
  );
}

// npm v7+: vulnerabilities.<pakiet>.via[] (obiekty = wlasciwe advisory; stringi = podatnosc odziedziczona).
// pnpm: advisories.<id> z github_advisory_id.
function advisoryZAudytu(dane) {
  const lista = [];
  for (const a of Object.values(dane.advisories || {})) {
    lista.push({
      id: a.github_advisory_id || String(a.id),
      sev: a.severity,
      pkg: a.module_name,
      title: a.title,
    });
  }
  for (const [nazwa, v] of Object.entries(dane.vulnerabilities || {})) {
    for (const zrodlo of v.via || []) {
      if (typeof zrodlo !== "object") continue;
      const ghsa = String(zrodlo.url || "").match(/GHSA-[\w-]+/);
      lista.push({
        id: ghsa ? ghsa[0] : String(zrodlo.source),
        sev: zrodlo.severity,
        pkg: zrodlo.name || nazwa,
        title: zrodlo.title,
      });
    }
  }
  return lista;
}

function main() {
  let dane;
  try {
    dane = JSON.parse(fs.readFileSync(process.argv[2] || "audit.json", "utf8"));
  } catch (blad) {
    console.error(`audit: brak albo uszkodzony JSON z audytu (${blad.message}) — fail-closed`);
    return 1;
  }
  if (dane.error) {
    console.error(
      `audit: audyt zwrocil blad — fail-closed: ${JSON.stringify(dane.error).slice(0, 200)}`,
    );
    return 1;
  }
  const dozwolone = wyjatki(process.env.AUDIT_ALLOW);
  const dzis = new Date().toISOString().slice(0, 10);
  const widziane = new Set();
  const blokuja = [];
  for (const a of advisoryZAudytu(dane)) {
    if (!BLOKUJACE.has(a.sev) || widziane.has(`${a.id}|${a.pkg}`)) continue;
    widziane.add(`${a.id}|${a.pkg}`);
    const wygasa = dozwolone.get(a.id);
    if (wygasa && wygasa >= dzis) {
      console.log(`audit: WYJATEK ${a.id} (${a.pkg}) do ${wygasa}`);
      continue;
    }
    blokuja.push(a);
  }
  for (const a of blokuja) console.error(`audit: ${a.sev} ${a.id} ${a.pkg} — ${a.title}`);
  console.log(`audit: blokujace high/critical = ${blokuja.length}`);
  return blokuja.length ? 1 : 0;
}

process.exitCode = main();
