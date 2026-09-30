#!/usr/bin/env python3
"""Validates data/incidents.json (format: see README). Exit 1 on errors.

The page skips malformed entries on its own; this check makes the workflow
fail so GitHub e-mails the owner about a broken file.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUSES = {"investigating", "identified", "monitoring", "resolved", "scheduled", "in_progress", "completed"}
IMPACTS = {"minor", "major", "critical", "maintenance"}
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")


def text(v, where, errors):
    if not isinstance(v, dict) or not isinstance(v.get("pl"), str) or not v["pl"].strip():
        errors.append(f"{where}: needs {{\"pl\": \"...\", \"en\": \"...\"}} (pl required)")
    elif "en" in v and not isinstance(v["en"], str):
        errors.append(f"{where}.en: must be a string")


def main() -> int:
    services = {s["id"] for s in json.loads((ROOT / "config/services.json").read_text())["services"]}
    try:
        doc = json.loads((ROOT / "data/incidents.json").read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"::error file=data/incidents.json::invalid JSON: {e}")
        return 1
    errors: list[str] = []
    incidents = doc.get("incidents")
    if doc.get("version") != 1 or not isinstance(incidents, list):
        errors.append('root: expected {"version": 1, "incidents": [...]}')
        incidents = []
    seen = set()
    for i, inc in enumerate(incidents):
        w = f"incidents[{i}]"
        if not isinstance(inc, dict):
            errors.append(f"{w}: must be an object")
            continue
        if not isinstance(inc.get("id"), str) or not ID.match(inc["id"]):
            errors.append(f"{w}.id: lowercase letters, digits and '-', 3-64 chars")
        elif inc["id"] in seen:
            errors.append(f"{w}.id: duplicate '{inc['id']}'")
        else:
            seen.add(inc["id"])
        text(inc.get("title"), f"{w}.title", errors)
        if inc.get("status") not in STATUSES:
            errors.append(f"{w}.status: one of {sorted(STATUSES)}")
        if inc.get("impact", "minor") not in IMPACTS:
            errors.append(f"{w}.impact: one of {sorted(IMPACTS)}")
        svcs = inc.get("services")
        if not isinstance(svcs, list) or not all(s in services for s in svcs):
            errors.append(f"{w}.services: list of ids from config/services.json {sorted(services)}")
        for k in ("createdAt", "resolvedAt", "scheduledStart", "scheduledEnd"):
            v = inc.get(k)
            if (k == "createdAt" or v is not None) and not (isinstance(v, str) and ISO.match(v)):
                errors.append(f"{w}.{k}: ISO 8601 date-time with zone, e.g. 2026-09-30T14:05:00Z")
        updates = inc.get("updates")
        if not isinstance(updates, list) or not updates:
            errors.append(f"{w}.updates: at least one entry")
            continue
        for j, u in enumerate(updates):
            uw = f"{w}.updates[{j}]"
            if not isinstance(u, dict):
                errors.append(f"{uw}: must be an object")
                continue
            if not (isinstance(u.get("at"), str) and ISO.match(u["at"])):
                errors.append(f"{uw}.at: ISO 8601 date-time with zone")
            if u.get("status") not in STATUSES:
                errors.append(f"{uw}.status: one of {sorted(STATUSES)}")
            text(u.get("body"), f"{uw}.body", errors)
    for e in errors:
        print(f"::error file=data/incidents.json::{e}")
    print(f"incidents.json: {len(incidents)} incident(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
