"""Wait for Vercel Production deployments of several merge commits at once (one GitHub login), then HTTP-check URLs.
usage: wait_prod_multi.py repo=sha[=url] ...   (timeout 25 min total)"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
token = os.environ["GITHUB_Token"]
OWNER = os.environ["GITHUB_OWNER"]  # wlasciciel repo floty; w publicznej wersji PG = wymagane env
HEADERS = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "mas-prod-wait/1.0"}
TIMEOUT_S = 1500
POLL_S = 30


def api(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def vercel_domain_for(repo: str) -> str:
    """Produkcyjna domena projektu Vercela o nazwie repo: custom > *.vercel.app. Pusty string = brak tokenu/projektu.
    Wymaga VERCEL_TOKEN w env (most: --secrets GITHUB_Token,VERCEL_TOKEN). Nie zgaduje po nazwie hosta."""
    vtoken = os.environ.get("VERCEL_TOKEN")
    if not vtoken:
        return ""
    vh = {"Authorization": f"Bearer {vtoken}", "User-Agent": "mas-prod-wait/1.0"}
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.vercel.com/v9/projects?search={repo}", headers=vh), timeout=30) as r:
            projects = json.loads(r.read().decode("utf-8")).get("projects", [])
        project = next((p for p in projects if p.get("name") == repo), None)
        if not project:
            return ""
        with urllib.request.urlopen(urllib.request.Request(f"https://api.vercel.com/v9/projects/{project['id']}/domains", headers=vh), timeout=30) as r:
            domains = json.loads(r.read().decode("utf-8")).get("domains", [])
    except (urllib.error.URLError, OSError, ValueError):
        return ""
    live = [d["name"] for d in domains if d.get("verified") and not d.get("redirect")]
    custom = [d for d in live if not d.endswith(".vercel.app")]
    pick = (custom or live or [""])[0]
    return f"https://{pick}" if pick else ""


targets = []
for arg in sys.argv[1:]:
    parts = arg.split("=", 2)
    sha = parts[1]
    if len(sha) < 40:  # deployments?sha= wymaga pelnego SHA
        sha = api(f"https://api.github.com/repos/{OWNER}/{parts[0]}/commits/{sha}")["sha"]
    targets.append({"repo": parts[0], "sha": sha, "url": parts[2] if len(parts) > 2 else "", "result": None})

deadline = time.time() + TIMEOUT_S
while time.time() < deadline and any(t["result"] is None for t in targets):
    for t in targets:
        if t["result"] is not None:
            continue
        try:
            deps = api(f"https://api.github.com/repos/{OWNER}/{t['repo']}/deployments?sha={t['sha']}&per_page=10")
        except (urllib.error.URLError, OSError):
            continue
        prod = [d for d in deps if str(d.get("environment", "")).lower().startswith("prod")]
        if not prod:
            continue
        statuses = api(prod[0]["statuses_url"])
        states = [s["state"] for s in statuses]
        if "success" in states:
            t["result"] = "success"
            if not t["url"]:
                # Retro 2026-09-06 (petla 6): URL podany z reki wskazal CUDZA strone (rental-site = inny projekt)
                # i skrypt zglosil "200 ok". Zrodlem prawdy jest Vercel: domeny projektu o nazwie repo (custom > *.vercel.app),
                # a dopiero potem environment_url z deploymentu.
                t["url"] = vercel_domain_for(t["repo"]) or next(
                    (s.get("environment_url") for s in statuses if s["state"] == "success" and s.get("environment_url")), "")
        elif any(s in ("failure", "error") for s in states):
            t["result"] = "FAILURE: " + "; ".join(s.get("description", "")[:80] for s in statuses if s["state"] in ("failure", "error"))
    if any(t["result"] is None for t in targets):
        time.sleep(POLL_S)

bad = 0
for t in targets:
    res = t["result"] or "TIMEOUT (no production deployment status)"
    line = f"{t['repo']:24s} {t['sha'][:7]} deploy={res}"
    if t["url"]:
        try:
            req = urllib.request.Request(t["url"], headers={"User-Agent": "Mozilla/5.0 (mas-prod-check)"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read(200000).decode("utf-8", "replace")
                final = resp.geturl()
                # *.vercel.app pod ochrona SSO przekierowuje na strone logowania Vercela, ktora TEZ jest <html>.
                # Bez tego testu skrypt raportowal 200 dla ekranu logowania (2026-09-06).
                sso = "vercel.com" in final and "vercel.com" not in t["url"]
                ok = resp.status == 200 and "<html" in body.lower() and not sso
                label = "SSO login (niezweryfikowane)" if sso else ("ok" if ok else "UNEXPECTED")
                line += f" | {t['url']} HTTP {resp.status} {label}"
                bad += 0 if ok else 1
        except urllib.error.HTTPError as err:
            line += f" | {t['url']} HTTP {err.code}"
            bad += 1
        except (urllib.error.URLError, OSError) as err:
            line += f" | {t['url']} ERROR {err}"
            bad += 1
    if res != "success":
        bad += 1
    print(line)
print(f"RESULT: {len(targets)} targets, problems: {bad}")
sys.exit(1 if bad else 0)
