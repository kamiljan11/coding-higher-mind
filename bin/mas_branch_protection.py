#!/usr/bin/env python3
"""mas_branch_protection: strict status checks na galezi domyslnej kazdego repo z quality.yml.

Po incydencie 2026-09-06 (parts-shop): dwa PR-y z zielonymi checkami, git bez konfliktu, a po drugim
squashu YAML workflow z duplikatem klucza -> main bez zadnej bramki. Checki PR-a testuja merge-ref z chwili
pushu; jedyne, co wymusza ponowne CI na AKTUALNYM wyniku merge'a, to `required_status_checks.strict=true`.

Dla kazdego repo: kontekst wymaganych checkow = nazwy jobow z .github/workflows/quality.yml (claude-review
NIE jest wymagane — moze byc skipped). enforce_admins=true, bo automat merguje tokenem wlasciciela i bez tego
ochrona nie dotyczylaby wlasnie automatu. Reviews NIE sa wymagane (solo workflow). Backup poprzedniej ochrony
-> --backup-dir/<repo>.json (404 = brak ochrony -> plik z {"none": true}).

Uzycie: infisical run --env=dev --backup-dir DIR [--skip travel-site] [--confirm]
Rollback jednego repo: PUT tego samego endpointu z zawartoscia backupu (albo DELETE, gdy {"none": true}).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys

API = "https://api.github.com"


def curl(method: str, url: str, token: str, body: dict | None = None) -> tuple[int, dict | list]:
    cmd = ["curl", "-sS", "-o", "-", "-w", "\n%{http_code}", "-X", method,
           "-H", f"Authorization: Bearer {token}", "-H", "User-Agent: mas-branch-protection/1.0",
           "-H", "Accept: application/vnd.github+json", url]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=False).stdout
    text, code = out.rsplit("\n", 1)
    return int(code), (json.loads(text) if text.strip() else {})


def job_names(workflow_yaml: str) -> list[str]:
    """Nazwy jobow (pole `name:` joba, a bez niego id joba) — to sa konteksty checkow w GitHubie."""
    names: list[str] = []
    in_jobs = False
    current_id: str | None = None
    for line in workflow_yaml.splitlines():
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue
        if in_jobs and re.match(r"^\S", line):  # koniec sekcji jobs
            break
        if not in_jobs:
            continue
        m_id = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if m_id:
            if current_id is not None and current_id not in names:
                names.append(current_id)
            current_id = m_id.group(1)
            continue
        m_name = re.match(r'^    name:\s*"?([^"#]+?)"?\s*$', line)
        if m_name and current_id is not None:
            names.append(m_name.group(1).strip())
            current_id = None  # nazwa zastepuje id
    if current_id is not None and current_id not in names:
        names.append(current_id)
    return names


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backup-dir", required=True)
    ap.add_argument("--skip", default="", help="repo do pominiecia, po przecinku")
    ap.add_argument("--only", default="", help="tylko te repo, po przecinku")
    ap.add_argument("--confirm", action="store_true")
    args = ap.parse_args()
    token = os.environ["GITHUB_Token"]
    skip = {s for s in args.skip.split(",") if s}
    only = {s for s in args.only.split(",") if s}
    os.makedirs(args.backup_dir, exist_ok=True)

    repos: list[dict] = []
    page = 1
    while True:
        code, batch = curl("GET", f"{API}/user/repos?per_page=100&affiliation=owner&page={page}", token)
        if code != 200 or not batch:
            break
        repos += batch  # type: ignore[arg-type]
        if len(batch) < 100:
            break
        page += 1

    problems = 0
    for r in sorted(repos, key=lambda x: x["name"]):
        name, full, branch = r["name"], r["full_name"], r["default_branch"]
        if name in skip or (only and name not in only):
            continue
        code, wf = curl("GET", f"{API}/repos/{full}/contents/.github/workflows/quality.yml?ref={branch}", token)
        if code != 200:
            continue
        yaml_text = base64.b64decode(wf["content"]).decode("utf-8", "replace")  # type: ignore[index]
        contexts = job_names(yaml_text)
        if not contexts:
            print(f"!!   {name:28s} quality.yml bez jobow? pomijam")
            problems += 1
            continue
        code, prev = curl("GET", f"{API}/repos/{full}/branches/{branch}/protection", token)
        backup = prev if code == 200 else {"none": True, "http": code}
        with open(os.path.join(args.backup_dir, f"{name}.json"), "w", encoding="utf-8") as fh:
            json.dump(backup, fh, indent=1)
        body = {
            "required_status_checks": {"strict": True, "contexts": contexts},
            "enforce_admins": True,
            "required_pull_request_reviews": None,
            "restrictions": None,
            "allow_force_pushes": False,
            "allow_deletions": False,
        }
        tag = "PROT" if code == 200 else "NEW "
        if not args.confirm:
            print(f"DRY  {name:28s} {tag} strict=true contexts={contexts}")
            continue
        code, res = curl("PUT", f"{API}/repos/{full}/branches/{branch}/protection", token, body)
        if code == 200:
            rsc = res.get("required_status_checks", {})  # type: ignore[union-attr]
            print(f"ok   {name:28s} strict={rsc.get('strict')} enforce_admins={res.get('enforce_admins', {}).get('enabled')} contexts={rsc.get('contexts')}")  # type: ignore[union-attr]
        else:
            problems += 1
            print(f"!!   {name:28s} HTTP {code}: {str(res.get('message', res))[:140]}")  # type: ignore[union-attr]
    print(f"\nproblems: {problems}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
