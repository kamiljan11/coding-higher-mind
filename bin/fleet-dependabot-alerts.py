#!/usr/bin/env python3
"""Otwarte alerty Dependabota high/critical w repo floty - KROK 1b rutyny fleet-cve-watch.

Zamiast petli `bash -c` w SKILL.md (2026-10-14): skrypt mozna zatwierdzic waska regula w rutynie bez nadzoru, a wynik
jest jednoznaczny (znacznik END + kod wyjscia), wiec pusty wynik nigdy nie udaje „0 high/critical" (ops-review etap1f).
`exclude` z pg/fleet-scope.json (travel-site) = zero zapytan. Archiwalne repo pomijane.

Uzycie (token tylko z mostu):
  infisical run --env=dev -- python3 ~/.claude/bin/fleet-dependabot-alerts.py
Wyjscie (TSV): `ALERT <repo> <severity> <ecosystem/pakiet> <ghsa> <scope> <wersja z fixem|->` (jeden wiersz na alert:
ten sam GHSA w runtime i development = 2 wiersze), `DISABLED <repo>` (403 „alerts are disabled" = znany stan, nie blad),
`ERR <repo> <kod>`, na koncu `END repos=N alerts=A disabled=D err=E`.
Exit 0 = komplet; 1 = brak repo, blad konfiguracji albo choc jeden ERR (rutyna: KROK 1b FAILED, nigdy „0 high/critical").
"""
import http.client
import importlib.util
import json
import os
import sys
import urllib.error
from pathlib import Path

_spec = importlib.util.spec_from_file_location("far", Path(__file__).with_name("fleet-active-repos.py"))
assert _spec is not None and _spec.loader is not None
far = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(far)

ALERTS_QUERY = "state=open&severity=high,critical&per_page=100"


def alert_row(a):
    adv = a.get("security_advisory") or {}
    dep = a.get("dependency") or {}
    pkg = dep.get("package") or {}
    fixed = ((a.get("security_vulnerability") or {}).get("first_patched_version") or {}).get("identifier") or "-"
    return (adv.get("severity", "?"), f"{pkg.get('ecosystem', '?')}/{pkg.get('name', '?')}", adv.get("ghsa_id", "?"),
            dep.get("scope") or "?", fixed)


def repo_alerts(owner, name, token, gh):
    """(rows, status): rows = krotki z alert_row, status 'ok' | 'disabled' | 'err <kod>'."""
    try:
        alerts = gh(f"/repos/{owner}/{name}/dependabot/alerts?{ALERTS_QUERY}", token)
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")
        except (OSError, AttributeError):
            body = ""
        if e.code == 403 and "alerts are disabled" in body.lower():
            return [], "disabled"
        return [], f"err {e.code}"
    except (OSError, http.client.HTTPException) as e:  # siec po ponowieniach w gh(): ERR tego repo, skan idzie dalej (data+ops etap1g)
        return [], f"err net:{type(e).__name__}"
    except ValueError:  # odpowiedz nie-JSON (code etap1h)
        return [], "err json"
    if not isinstance(alerts, list):  # obiekt bledu zamiast listy
        return [], "err shape"
    if len(alerts) >= 100:  # pelna strona = lista moze byc niepelna; glosny blad zamiast zanizonej liczby
        return [], "err truncated"
    try:
        return [alert_row(a) for a in alerts], "ok"
    except (AttributeError, TypeError):  # element listy nie jest obiektem alertu (code etap1k)
        return [], "err shape"


def run(cfg, token, out=print, list_repos=far.list_repos, gh=far.gh):
    """Zwraca kod wyjscia; list_repos/gh podmieniane w testach."""
    exclude = set(cfg.get("exclude", []))
    repos = sorted(r["name"] for r in list_repos(cfg["owner"], token) if not r["archived"] and r["name"] not in exclude)
    if not repos:
        out(f"ERR\t-\tAPI nie zwrocilo zadnego repo wlasciciela {cfg['owner']} (zakres tokenu?)")
        out("END repos=0 alerts=0 disabled=0 err=1")
        return 1
    n_alerts = n_disabled = n_err = 0
    for name in repos:
        rows, status = repo_alerts(cfg["owner"], name, token, gh)
        if status == "disabled":
            n_disabled += 1
            out(f"DISABLED\t{name}")
        elif status != "ok":
            n_err += 1
            out(f"ERR\t{name}\t{status.split(' ', 1)[1]}")
        for row in rows:
            n_alerts += 1
            out("\t".join(("ALERT", name) + row))
    out(f"END repos={len(repos)} alerts={n_alerts} disabled={n_disabled} err={n_err}")
    return 1 if n_err else 0


def main():
    try:
        cfg = json.loads(far.SCOPE.read_text(encoding="utf-8"))
        if "travel-site" not in cfg.get("exclude", []):  # regula uzytkownika; brak = zepsuty config, nie pusta lista
            raise ValueError("fleet-scope.json: exclude bez travel-site")
        token = os.environ.get("GITHUB_Token") or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if not token:
            raise RuntimeError("brak tokenu - uruchom przez menedzer sekretow (np. Infisical CLI) (--secrets GITHUB_Token)")
        return run(cfg, token)
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError, AttributeError, RuntimeError) as e:  # siec/HTTP, JSON, config = jawny FAILED z END
        print(f"fleet-dependabot-alerts: BLAD {type(e).__name__}: {e}", file=sys.stderr)
        print("END repos=0 alerts=0 disabled=0 err=1")
        return 1


if __name__ == "__main__":
    sys.exit(main())
