#!/usr/bin/env python3
"""Checks wirelab services once and updates data/status.json and data/history.json.

Standard library only (runs on the stock GitHub Actions runner, no installs).

History is time-weighted: the time since the last *committed* check
(`accountedUntil`) is credited to the state that was committed then. The
workflow commits on every state change, so between commits the state did not
change and nothing is lost when intermediate runs are not committed.

Prints `commit=true|false` to $GITHUB_OUTPUT.
"""
from __future__ import annotations

import imaplib
import json
import os
import smtplib
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "services.json"
STATUS = ROOT / "data" / "status.json"
HISTORY = ROOT / "data" / "history.json"

HISTORY_DAYS = 90
COMMIT_EVERY = timedelta(minutes=55)  # "once an hour", tolerant of cron jitter
MAX_GAP = timedelta(hours=3)  # longer gaps (Actions outage) count as "no data"
RETRY_DELAY = 5
CERT_WARN_DAYS = 14
BODY_LIMIT = 256 * 1024

# short keys used in history.json
KEY = {"up": "u", "degraded": "g", "down": "d", "maintenance": "m", "prelaunch": "p"}

WARNINGS: list[str] = []


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


# ---------------------------------------------------------------- checks


class _NoRedirectErrors(urllib.request.HTTPErrorProcessor):
    """Return 4xx/5xx responses instead of raising, so we can read status and headers."""

    def http_response(self, request, response):
        return response

    https_response = http_response


def http_get(url: str, cfg: dict) -> dict:
    opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler(), _NoRedirectErrors())
    req = urllib.request.Request(url, headers={
        "User-Agent": cfg["userAgent"],
        "Accept": "application/json, text/html;q=0.9, */*;q=0.5",
        "Cache-Control": "no-cache",
    })
    t0 = time.monotonic()
    try:
        with opener.open(req, timeout=cfg["timeoutSeconds"]) as resp:
            body = resp.read(BODY_LIMIT)
            ms = int((time.monotonic() - t0) * 1000)
            return {"code": resp.status, "ms": ms, "body": body, "headers": dict(resp.headers.items())}
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, ssl.SSLError) or "CERTIFICATE" in str(reason).upper():
            return {"error": "tls"}
        if "timed out" in str(reason):
            return {"error": "timeout"}
        return {"error": "connect"}
    except TimeoutError:
        return {"error": "timeout"}
    except (OSError, ValueError):
        return {"error": "connect"}


def classify_http(r: dict, ok: list[int], maintenance: list[int], cfg: dict) -> dict:
    if "error" in r:
        return {"state": "down", "detail": r["error"]}
    code, ms = r["code"], r["ms"]
    if code in ok:
        state = "degraded" if ms > cfg["slowMs"] else "up"
        return {"state": state, "code": code, "ms": ms, "detail": "slow" if state == "degraded" else None}
    if code in maintenance and any(k.lower() == "retry-after" for k in r["headers"]):
        return {"state": "maintenance", "code": code, "ms": ms, "detail": "maintenance"}
    return {"state": "down", "code": code, "ms": ms, "detail": f"http_{code}"}


def check_http(check: dict, cfg: dict) -> dict:
    r = http_get(check["url"], cfg)
    return classify_http(r, check.get("ok", [200]), check.get("maintenance", []), cfg)


def check_health(check: dict, cfg: dict) -> dict:
    """`GET /api/health` returning {"ok": bool, ...}. Falls back to the home page
    while the endpoint is not deployed yet (404 or a non-JSON answer)."""
    r = http_get(check["url"], cfg)
    if "error" not in r:
        data = None
        try:
            data = json.loads(r["body"].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        if isinstance(data, dict) and "ok" in data:
            if r["code"] == 200 and data.get("ok") is True:
                state = "degraded" if r["ms"] > cfg["slowMs"] else "up"
                return {"state": state, "code": 200, "ms": r["ms"], "detail": "slow" if state == "degraded" else None}
            return {"state": "down", "code": r["code"], "ms": r["ms"], "detail": "health"}
    # not deployed yet, or answered by something else (maintenance page, proxy error)
    fb = check.get("fallback")
    if not fb:
        return classify_http(r, [200], [], cfg)
    return check_http(fb, cfg)


def _cert_days(cert: dict | None) -> int | None:
    if not cert or "notAfter" not in cert:
        return None
    expires = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), timezone.utc)
    return (expires - now_utc()).days


def check_mail_port(host: str, p: dict, cfg: dict) -> tuple[bool, str | None, int | None]:
    ctx = ssl.create_default_context()
    timeout = cfg["timeoutSeconds"]
    t0 = time.monotonic()
    try:
        if p["mode"] == "starttls-smtp":
            with smtplib.SMTP(host, p["port"], local_hostname="status.wirelab.pl", timeout=timeout) as s:
                s.ehlo()
                if not s.has_extn("starttls"):
                    return False, "no_starttls", None
                s.starttls(context=ctx)
                days = _cert_days(s.sock.getpeercert())
                s.ehlo()
        elif p["mode"] == "tls-imap":
            m = imaplib.IMAP4_SSL(host, p["port"], ssl_context=ctx, timeout=timeout)
            days = _cert_days(m.sock.getpeercert())
            m.logout()
        else:
            return False, "config", None
    except ssl.SSLError:
        return False, "tls", None
    except (TimeoutError, OSError, smtplib.SMTPException, imaplib.IMAP4.error) as e:
        return False, "timeout" if "timed out" in str(e) else "connect", None
    ms = int((time.monotonic() - t0) * 1000)
    if days is not None and days < CERT_WARN_DAYS:
        WARNINGS.append(f"TLS certificate for {host}:{p['port']} expires in {days} days")
    return True, None, ms


def check_mail(check: dict, cfg: dict) -> dict:
    results = [(p, *check_mail_port(check["host"], p, cfg)) for p in check["ports"]]
    failed = [p["label"] for p, ok, _, _ in results if not ok]
    times = [ms for _, ok, _, ms in results if ok and ms is not None]
    ms = max(times) if times else None
    if not failed:
        return {"state": "up", "ms": ms, "detail": None}
    if len(failed) < len(results):
        return {"state": "degraded", "ms": ms, "detail": "partial", "failed": failed}
    return {"state": "down", "detail": "connect", "failed": failed}


CHECKS = {"http": check_http, "health": check_health, "mail": check_mail}


def run_service(svc: dict, cfg: dict) -> dict:
    fn = CHECKS[svc["check"]["type"]]
    res = fn(svc["check"], cfg)
    if res["state"] == "down":
        time.sleep(RETRY_DELAY)  # one retry, so a single dropped packet is not an outage
        res = fn(svc["check"], cfg)
    if svc.get("prelaunch") and res["state"] == "down":
        res = {"state": "prelaunch", "detail": res.get("detail")}
    return res


# ---------------------------------------------------------------- history


def credit(history: dict, svc_id: str, state: str, start: datetime, end: datetime) -> None:
    """Add seconds in [start, end) to `state`, split across UTC days."""
    key = KEY.get(state)
    if not key:
        return
    t = start
    while t < end:
        next_day = (t + timedelta(days=1)).replace(hour=0, minute=0, second=0)
        stop = min(end, next_day)
        day = history["days"].setdefault(t.strftime("%Y-%m-%d"), {})
        rec = day.setdefault(svc_id, {})
        rec[key] = rec.get(key, 0) + int((stop - t).total_seconds())
        t = stop


def add_sample(history: dict, svc_id: str, when: datetime, ms: int | None) -> None:
    if ms is None:
        return
    rec = history["days"].setdefault(when.strftime("%Y-%m-%d"), {}).setdefault(svc_id, {})
    rec["ms"] = rec.get("ms", 0) + ms
    rec["n"] = rec.get("n", 0) + 1


def prune(history: dict, today: datetime) -> None:
    oldest = (today - timedelta(days=HISTORY_DAYS - 1)).strftime("%Y-%m-%d")
    history["days"] = {d: v for d, v in sorted(history["days"].items()) if d >= oldest}


def dump_history(history: dict) -> str:
    # one day per line: small diffs, still valid JSON
    lines = [f'  {json.dumps(d)}: {json.dumps(v, sort_keys=True, separators=(",", ":"))}'
             for d, v in sorted(history["days"].items())]
    return '{\n "version": 1,\n "days": {\n' + ",\n".join(lines) + "\n }\n}\n"


# ---------------------------------------------------------------- main


def main() -> int:
    cfg = load_json(CONFIG, None)
    if cfg is None:
        print("config/services.json missing or invalid", file=sys.stderr)
        return 2
    prev = load_json(STATUS, {})
    history = load_json(HISTORY, {"version": 1, "days": {}})
    history.setdefault("days", {})
    prev_services = {s["id"]: s for s in prev.get("services", [])}
    accounted = parse_iso(prev.get("accountedUntil"))

    started = now_utc()
    results = {svc["id"]: run_service(svc, cfg) for svc in cfg["services"]}
    now = now_utc()

    # credit the elapsed time to the previously committed states
    if accounted and timedelta(0) < now - accounted <= MAX_GAP:
        for sid, ps in prev_services.items():
            if any(s["id"] == sid for s in cfg["services"]):
                credit(history, sid, ps.get("state"), accounted, now)

    changed = False
    services = []
    for svc in cfg["services"]:
        res = results[svc["id"]]
        ps = prev_services.get(svc["id"])
        if not ps or ps.get("state") != res["state"]:
            changed = True
            since = iso(started)
        else:
            since = ps.get("since") or iso(started)
        add_sample(history, svc["id"], now, res.get("ms"))
        services.append({
            "id": svc["id"],
            "name": svc["name"],
            "desc": svc.get("desc"),
            "link": svc.get("link"),
            "prelaunch": bool(svc.get("prelaunch")),
            "state": res["state"],
            "since": since,
            "ms": res.get("ms"),
            "code": res.get("code"),
            "detail": res.get("detail"),
            "failed": res.get("failed"),
        })
    if set(prev_services) != {s["id"] for s in cfg["services"]}:
        changed = True

    prune(history, now)
    hourly = accounted is None or now - accounted >= COMMIT_EVERY
    commit = changed or hourly

    status = {
        "version": 1,
        "checkedAt": iso(now),
        "accountedUntil": iso(now),
        "services": [{k: v for k, v in s.items() if v is not None} for s in services],
    }
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(status, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    HISTORY.write_text(dump_history(history), encoding="utf-8")

    reason = "state change" if changed else ("hourly" if hourly else "none")
    print(f"checked at {iso(now)}; commit: {commit} ({reason})")
    for s in services:
        extra = ", ".join(f"{k}={s[k]}" for k in ("code", "ms", "detail", "failed") if s.get(k) is not None)
        print(f"  {s['id']:<8} {s['state']:<11} {extra}")
    for w in WARNINGS:
        print(f"::warning::{w}")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"commit={'true' if commit else 'false'}\nreason={reason}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("| service | state | ms | detail |\n|---|---|---|---|\n")
            for s in services:
                f.write(f"| {s['id']} | {s['state']} | {s.get('ms') or ''} | {s.get('detail') or ''} |\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
