#!/usr/bin/env python3
"""Lista AKTYWNYCH repo floty dla rutyn (fleet-pr-reviewer, fleet-cve-watch) - z historii GitHuba, nie z listy na sztywno.

uzytkownik 2026-10-14: po postawieniu projektu rzadko do niego wraca, wiec rutyny sprawdzaja tylko repo, nad ktorymi
realnie pracujemy. Aktywne = w ostatnich N dniach (pg/fleet-scope.json: active_days) commit na galezi domyslnej
(bez merge-commitow) ALBO PR wlasciciela otwarty w tym oknie. Nie licza sie:
- dni przegladu floty: dzien z ruchem w >= sweep_min_repos repo naraz (2026-10-05: handover + fixy w ~20 repo)
  to robota PG na calej flocie, nie praca nad projektem;
- wdrozenia PG: ten sam tytul PR w >= 3 repo;
- boty zaleznosci (dependency_bots) i slady samych rutyn (chore(deps)/cve, auto-fix po review, learnings) -
  inaczej PR rutyny robilby repo "aktywnym" na kolejny miesiac.
`exclude` (travel-site) = nigdy, takze w podsumowaniach. `pin` = zawsze, nawet uspione.

Uzycie (token tylko z mostu):
  infisical run --env=dev -- python3 ~/.claude/bin/fleet-active-repos.py [--days N] [--json]
Wyjscie: nazwy aktywnych repo po jednej w linii; --json: {days, since, sweep_days, active:[{name, last_activity, source,
evidence}], dormant:[...], excluded:[...], warnings:[...]} (warnings = wpis pin/exclude bez repo; tez na stderr).
Exit 0 = OK (takze 0 aktywnych), 1 = blad API/konfiguracji. Rutyna przy exit 1 konczy sie FAILED - NIE wraca do calej floty.
"""
import argparse
import datetime as dt
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCOPE = Path(__file__).resolve().parent.parent / "pg" / "fleet-scope.json"
API = "https://api.github.com"
# Commity/PR-y samych rutyn i botow zaleznosci - nie sa praca nad projektem.
ROUTINE_MSG = re.compile(
    r"^(chore|build|fix)\((deps|deps-dev|cve)\)|^chore/cve|\[auto-fix po review\]|^docs\(review\): learnings|^bump ",
    re.IGNORECASE,
)
SQUASH_SUFFIX = re.compile(r"\s*\(#\d+\)$")
ROLLOUT_MIN_REPOS = 3  # ten sam tytul PR w >= 3 repo = wdrozenie PG na flote, nie praca nad projektem


def is_activity(author_login, message, bots, rollout_titles=frozenset()):
    """True = commit/PR swiadczy o pracy nad projektem (nie bot zaleznosci, nie slad rutyny, nie wdrozenie floty)."""
    if (author_login or "") in bots:
        return False
    msg = SQUASH_SUFFIX.sub("", (message or "").strip())
    return not ROUTINE_MSG.search(msg) and msg not in rollout_titles


def rollout_titles(prs):
    """Tytuly PR obecne w >= ROLLOUT_MIN_REPOS roznych repo. prs = [(repo, title)]."""
    repos_by_title = {}
    for repo, title in prs:
        repos_by_title.setdefault((title or "").strip(), set()).add(repo)
    return frozenset(t for t, rs in repos_by_title.items() if len(rs) >= ROLLOUT_MIN_REPOS)


def sweep_days(events, min_repos):
    """Dni (YYYY-MM-DD) z ruchem w >= min_repos repo naraz. events = {repo: [(iso, dowod, zrodlo)]}."""
    repos_by_day = {}
    for repo, evs in events.items():
        for iso, _, _ in evs:
            repos_by_day.setdefault(iso[:10], set()).add(repo)
    return sorted(d for d, rs in repos_by_day.items() if len(rs) >= min_repos)


def unknown_names(repos, cfg):
    """Wpisy pin/exclude bez repo o tej nazwie (literowka, zmiana nazwy) - inaczej zawor po cichu przestaje dzialac."""
    names = {r["name"] for r in repos}
    return sorted(n for key in ("pin", "exclude") for n in cfg.get(key, []) if n not in names)


def classify(repos, events, cfg, since_iso):
    """Czysta funkcja: repos = [{name, archived, pushed_at}], events = {repo: [(iso, dowod, 'commit'|'pr')]}."""
    exclude = set(cfg.get("exclude", []))
    pin = set(cfg.get("pin", []))
    sweeps = set(sweep_days({r: e for r, e in events.items() if r not in exclude}, int(cfg.get("sweep_min_repos", 8))))
    active, dormant, excluded = [], [], []
    for r in sorted(repos, key=lambda x: x["name"]):
        name = r["name"]
        if name in exclude:
            excluded.append(name)
            continue
        if r.get("archived"):
            continue
        hits = [e for e in events.get(name, []) if e[0] >= since_iso and e[0][:10] not in sweeps]
        if hits:
            ts, evidence, src = max(hits)
            active.append({"name": name, "last_activity": ts, "source": src, "evidence": evidence})
        elif name in pin:
            active.append({"name": name, "last_activity": r.get("pushed_at"), "source": "pin", "evidence": "pg/fleet-scope.json pin"})
        else:
            dormant.append(name)
    return active, dormant, excluded, sorted(sweeps)


RETRY_STATUS = {429, 500, 502, 503, 504}


def gh(path, token, attempts=3, sleep=time.sleep):
    """GET z GitHub API. Przejsciowe 429/5xx i bledy sieci: do 3 prob z backoffem (Retry-After <= 60 s) — jeden blip API
    nie moze kosztowac miesiaca skanu CVE (ops-review 2026-10-14). Inne bledy HTTP leca od razu."""
    req = urllib.request.Request(API + path, headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    req.add_unredirected_header("Authorization", "Bearer " + token)  # token floty nie idzie za przekierowaniem (security etap1e F3)
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code not in RETRY_STATUS or i == attempts - 1:
                raise
            wait = min(int(e.headers.get("Retry-After") or 0) or 2 ** (i + 1), 60)
        except (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError):
            # zerwane polaczenie bez odpowiedzi (RemoteDisconnected) i timeout odczytu nie sa URLError (ops-review etap1c)
            if i == attempts - 1:
                raise
            wait = 2 ** (i + 1)
        print(f"fleet-active-repos: ponawiam {path.split('?')[0]} za {wait} s (proba {i + 2}/{attempts})", file=sys.stderr)
        sleep(wait)
    raise RuntimeError("nieosiagalne")  # petla zawsze zwraca albo rzuca


def list_repos(owner, token):
    out, page = [], 1
    while True:
        batch = gh(f"/user/repos?affiliation=owner&per_page=100&page={page}", token)
        out += [{"name": r["name"], "archived": r["archived"], "pushed_at": r.get("pushed_at") or "",
                 "default_branch": r.get("default_branch") or "main"}
                for r in batch if r["owner"]["login"] == owner]
        if len(batch) < 100:
            return out
        page += 1


def commit_events(owner, repos, since_iso, bots, rollouts, token):
    """{repo: [(iso, opis, 'commit')]} - commity na galezi domyslnej w oknie (max 100 najnowszych na repo)."""
    found, tried, skipped = {}, 0, 0
    for r in repos:
        if r["archived"] or r["pushed_at"] < since_iso:
            continue  # brak pusha w oknie = brak commitow w oknie; oszczedza zapytania
        tried += 1
        q = urllib.parse.urlencode({"sha": r["default_branch"], "since": since_iso, "per_page": 100})
        try:
            commits = gh(f"/repos/{owner}/{r['name']}/commits?{q}", token)
        except urllib.error.HTTPError as e:
            if e.code not in (404, 409):  # 409 = puste repo, 404 = brak galezi; reszta (401/403) = blad calego przebiegu
                raise
            print(f"fleet-active-repos: pomijam commity {r['name']} (HTTP {e.code})", file=sys.stderr)
            skipped += 1
            continue
        for c in commits:
            if len(c.get("parents") or []) > 1:
                continue  # merge commit to nie praca; commity PR-a sa na galezi z wlasnymi opisami
            login = (c.get("author") or {}).get("login") or ""
            first = c["commit"]["message"].splitlines()[0] if c["commit"]["message"] else ""
            if is_activity(login, first, bots, rollouts):
                found.setdefault(r["name"], []).append((c["commit"]["committer"]["date"], first[:80], "commit"))
    if tried and skipped == tried:  # token bez dostepu do tresci repo daje 404 wszedzie = pusty, „zdrowy" miesiac (code-review etap1c)
        raise RuntimeError(f"wszystkie {tried} repo z pushem w oknie zwrocily 404/409 na commitach - sprawdz zakres tokenu")
    return found


def search_prs(owner, since_iso, token):
    """Wszystkie PR wlasciciela utworzone od since (stronicowanie: search zwraca max 100 na strone, 1000 lacznie)."""
    q = urllib.parse.quote(f"is:pr author:{owner} user:{owner} created:>={since_iso[:10]}")  # user: = tylko repo floty, nie PR-y w cudzych
    items = []
    for page in range(1, 11):
        res = gh(f"/search/issues?q={q}&per_page=100&page={page}", token)
        if res.get("incomplete_results"):  # timeout po stronie GitHuba = czesciowa lista -> repo „uspione" po cichu (code-review etap1e)
            raise RuntimeError("Search API zwrocilo incomplete_results - lista PR niepelna, powtorz przebieg")
        batch = res.get("items", [])
        items += batch
        if len(batch) < 100:
            return items
    raise RuntimeError("ponad 1000 PR w oknie (limit Search API) - lista niepelna, skroc active_days")


def pr_events(items, bots, rollouts):
    """{repo: [(created_iso, tytul, 'pr')]}; created_at, nie updated_at: komentarz bota (Vercel, CI) to nie praca."""
    found = {}
    for it in items:
        if not is_activity((it.get("user") or {}).get("login"), it.get("title"), bots, rollouts):
            continue
        name = it["repository_url"].rsplit("/", 1)[-1]
        found.setdefault(name, []).append((it["created_at"], (it.get("title") or "")[:80], "pr"))
    return found


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        cfg = json.loads(SCOPE.read_text(encoding="utf-8"))
        days = a.days if a.days is not None else int(cfg["active_days"])
        if days < 1:
            raise ValueError("active_days musi byc >= 1")
        token = os.environ.get("GITHUB_Token") or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if not token:
            raise RuntimeError("brak tokenu - uruchom przez menedzer sekretow (np. Infisical CLI) (--secrets GITHUB_Token)")
        since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        bots = set(cfg.get("dependency_bots", []))
        repos = list_repos(cfg["owner"], token)
        if not repos:  # token bez dostepu do repo wlasciciela wygladalby jak zdrowy, pusty miesiac (ops-review 2026-10-14)
            raise RuntimeError(f"API nie zwrocilo zadnego repo wlasciciela {cfg['owner']} - sprawdz zakres tokenu")
        prs = search_prs(cfg["owner"], since, token)
        rollouts = rollout_titles([(it["repository_url"].rsplit("/", 1)[-1], it.get("title")) for it in prs])
        exclude = set(cfg.get("exclude", []))  # travel-site: nawet zapytania o commity nie wysylamy (data etap1e)
        events = commit_events(cfg["owner"], [r for r in repos if r["name"] not in exclude], since, bots, rollouts, token)
        for repo, evs in pr_events(prs, bots, rollouts).items():
            events.setdefault(repo, []).extend(evs)
        active, dormant, excluded, sweeps = classify(repos, events, cfg, since)
        warnings = [f"pin/exclude bez repo: {n}" for n in unknown_names(repos, cfg)]
        for w in warnings:
            print(f"fleet-active-repos: UWAGA {w}", file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as e:  # siec/HTTP (OSError), JSON, config = jawny FAILED, nigdy cicha pelna flota
        print(f"fleet-active-repos: BLAD {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    if a.json:
        print(json.dumps({"days": days, "since": since, "sweep_days": sweeps, "active": active, "dormant": dormant,
                          "excluded": excluded, "warnings": warnings}, indent=1, ensure_ascii=False))
    else:
        print("\n".join(r["name"] for r in active))
    return 0


if __name__ == "__main__":
    sys.exit(main())
