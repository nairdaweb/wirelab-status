# wirelab status

Source of [status.wirelab.pl](https://status.wirelab.pl): a static status page plus a GitHub Actions checker that runs outside wirelab's own servers.

## How it works

- `.github/workflows/check.yml` runs every 5 minutes (GitHub may delay scheduled runs by 5–15 min), on every push to `main` and on demand.
- `scripts/check.py` (Python standard library only) checks the services from `config/services.json`, writes `data/status.json` and updates `data/history.json`.
- Results are committed only when a service changes state or about once an hour. The page is deployed to GitHub Pages on every run, so "last checked" stays fresh.
- History is time-weighted: the time since the last committed check is credited to the state committed then. Every state change is committed, so the runs that are not committed lose nothing. Gaps over 3 h (for example an Actions outage) count as "no data".
- `scripts/validate_incidents.py` runs last. If `data/incidents.json` is broken, the page still deploys and skips the bad entries, but the run fails and GitHub e-mails the owner.

| Service | Check | Up when |
|---|---|---|
| wirelab.pl | `GET /api/health` → `{"ok": true}`; until it exists, falls back to `GET /` | 200; `503` with `Retry-After` = maintenance |
| Academy | `GET https://akademia.wirelab.pl/` | 200 |
| Blog | `GET https://blog.wirelab.pl/` | 200 |
| Forum | `GET https://forum.wirelab.pl/ping` | 200; while `"prelaunch": true` a failure shows as "before launch", not as an outage |
| Docs | `GET https://docs.wirelab.pl/` | 200 or 401 (behind basic auth) |
| Email | `mail.wirelab.pl` SMTP 587 (STARTTLS) and IMAPS 993, TLS certificate verified, no login | both up; one down = degraded |

Responses slower than 5 s count as degraded. A failed check is retried once after 5 s. TLS certificates expiring within 14 days on the mail host produce a workflow warning. Phone alerts come from UptimeRobot, not from this repo.

States: `up`, `degraded`, `down`, `maintenance`, `prelaunch`. Uptime = (up + degraded) / (up + degraded + down); maintenance and prelaunch time is excluded.

Never add `dev.wirelab.pl` or `vault.wirelab.pl` here: the repo and the page are public.

## Data files

- `data/status.json`: current state per service, `checkedAt`, `accountedUntil`. Written by the workflow only.
- `data/history.json`: one entry per UTC day, 90 days, seconds per state (`u` up, `g` degraded, `d` down, `m` maintenance, `p` prelaunch) and response time sum/count (`ms`, `n`). Written by the workflow only.
- `data/incidents.json`: written by people and the admin panel.

## `data/incidents.json`

```json
{
  "version": 1,
  "incidents": [
    {
      "id": "2026-09-30-mail-smtp",
      "title": { "pl": "Opóźnienia w wysyłce poczty", "en": "Delayed outgoing email" },
      "status": "monitoring",
      "impact": "minor",
      "services": ["mail"],
      "createdAt": "2026-09-30T14:42:00Z",
      "resolvedAt": null,
      "updates": [
        { "at": "2026-09-30T15:20:00Z", "status": "monitoring",
          "body": { "pl": "Poprawka wdrożona, obserwujemy.", "en": "Fix deployed, monitoring." } },
        { "at": "2026-09-30T14:42:00Z", "status": "investigating",
          "body": { "pl": "Sprawdzamy problem z portem 587.", "en": "Looking into port 587." } }
      ]
    }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | unique, `[a-z0-9-]`, 3–64 chars. Suggested: `YYYY-MM-DD-short-name` |
| `title`, `updates[].body` | `{"pl": "...", "en": "..."}`; `pl` required, missing `en` falls back to `pl`. Plain text, newlines kept, no HTML |
| `status` | incidents: `investigating`, `identified`, `monitoring`, `resolved`; maintenance: `scheduled`, `in_progress`, `completed` |
| `impact` | `minor` (default), `major`, `critical`, `maintenance` |
| `services` | ids from `config/services.json`: `web`, `academy`, `blog`, `forum`, `docs`, `mail` |
| `createdAt`, `resolvedAt`, `updates[].at` | ISO 8601 with zone (`Z` preferred). Set `resolvedAt` when the status becomes `resolved`/`completed` |
| `scheduledStart`, `scheduledEnd` | optional, for `impact: "maintenance"` announced ahead |
| `updates` | at least one; any order (the page sorts newest first) |

An incident is "current" until its status is `resolved` or `completed` (a `scheduled` one until `scheduledEnd` passes). Resolved incidents from the last 90 days appear under past incidents and tint that day's bar for the listed services. Do not delete old incidents; they age out of the page by themselves. Keep the file small: archive entries older than a year if it grows.

## Writing incidents through the GitHub API (admin panel)

Use a fine-grained personal access token limited to this repository with **Contents: Read and write** (nothing else). Keep it server-side only (`.env`, e.g. `STATUS_GITHUB_TOKEN`). Headers for every call:

```
Authorization: Bearer <token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: wirelab-admin
```

1. Read the current file and its `sha`:

   ```
   GET https://api.github.com/repos/<owner>/wirelab-status/contents/data/incidents.json?ref=main
   ```
   Response: `sha` and `content` (base64, UTF-8 JSON; decode after removing newlines).

2. Change the JSON (add an incident, or add an update and change `status`), validate it with the rules above, then write it back:

   ```
   PUT https://api.github.com/repos/<owner>/wirelab-status/contents/data/incidents.json
   {
     "message": "incident: 2026-09-30-mail-smtp monitoring",
     "content": "<base64 of the new UTF-8 JSON>",
     "sha": "<sha from step 1>",
     "branch": "main"
   }
   ```
   `200` = saved. `409` or `422` with a sha mismatch = someone else changed the file: repeat from step 1 (retry 2–3 times). `401`/`403` = token expired or wrong scope. `404` = wrong owner/repo or the token lacks access.

3. The push triggers the workflow; the page shows the change after the deploy, usually within 1–2 minutes.

Only ever write `data/incidents.json`. The workflow writes `status.json` and `history.json` and rebases over pushes to other files, so the two never conflict.

Emergency without the panel: edit `data/incidents.json` in the GitHub web UI or the GitHub mobile app and commit to `main`.

## Local run

```sh
python3 scripts/check.py        # real checks, updates data/
python3 scripts/validate_incidents.py
python3 -m http.server 8000     # open http://localhost:8000/
```

## Credits

Fonts: Manrope and Sora, SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`). The wirelab logo belongs to wirelab.
