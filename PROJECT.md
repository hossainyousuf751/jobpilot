# JobPilot: project guidelines

How the code is organised and the rules every change follows. Product scope lives in `SPEC.md`; Claude-specific workflow in `CLAUDE.md`.

## Architecture
```
renderer (src/ui)  ──window.api──▶  preload.js  ──IPC invoke──▶  main.js handlers
   untrusted-safe DOM                allow-list                 validate, then call:
                                                                 ├─ db.js       SQLite (node:sqlite)
                                                                 ├─ sources.js  job fetchers ──▶ jobspy_fetch.py (Python)
                                                                 ├─ match.js    CV → profile, job → score/eligibility
                                                                 └─ recruiters.js contact extraction
main.js also owns: 30-min poller, notifications, secrets (safeStorage), webview hardening.
```
| Module | Owns | Must not |
|---|---|---|
| `match.js` | Pure functions: CV text to profile, job to `{score, eligible, reasons}` | Touch I/O, Electron or the DB |
| `sources.js` | Fetching and normalising jobs; per-source status | Score jobs or write the DB |
| `jobspy_fetch.py` | One JobSpy run: JSON on stdin, JSON on stdout | Print anything else to stdout |
| `db.js` | Schema, migrations and queries | Contain business rules beyond constraints |
| `recruiters.js` | Contact extraction; the hiring-team script for the viewed page | Navigate or crawl pages |
| `main.js` | IPC, validation, orchestration, OS integration | Hold scoring or parsing logic |
| `src/ui/*` | Rendering and user actions | Use `innerHTML` with data; call Node |

## Data contracts
**Normalised job** (every source returns exactly this):
`{ id, source, title, company, location, remote, url, description, posted_at }`
- `id` is `<source>:<native id>`, which must be stable across runs because it drives deduplication and alerts.
- `url` must be http(s); jobs without a title or a valid URL are dropped in `fetchAll`.
- Optional fields: `emails` (addresses the site listed; turned into recruiters) and `company_url` (the employer's own website, never a job board page; validated in `main.js`, used for Hunter.io). Document any new ones here.

**Profile** (stored as JSON in `profile`, defaults in `main.js` `DEFAULT_PROFILE`):
- `skills[]`, `years`, `roles[]` (search queries, max 5), `locations[]` (on-site, "City, Country"; first one is searched), `distanceKm`, `relocate[]` (countries, one searched per refresh), `remoteFrom[]` (regions), `needsSponsorship`, `minScore`, `adzunaCountry`, `cvFile`.
- New fields need a default in `DEFAULT_PROFILE`, clamping in `saveProfile`, and a form field in `index.html`.

**Score result:** `{ score: 0–100, eligible, reasons: { matched, missing, notes, blockers } }`. Any blocker means the job is ineligible. Notes are shown to the user, never silently dropped.

## Conventions
- **Plain stack:** CommonJS, no build step, no framework, no TypeScript. Two-space indent, single quotes, semicolons. Match the surrounding code.
- **Comments say why, not what.** One line, above the code it explains. Deliberate shortcuts get `// ponytail: <limit>, <upgrade path>`.
- **DOM:** build it with the `h()` helper in `app.js`. Text always goes through `textContent`. No inline event attributes (the CSP forbids inline scripts).
- **Errors:**
  - Handlers throw `Error` with a user-readable message; the renderer's `guard()` shows it as a toast.
  - Convert non-`Error` rejections, as pdf.js produces, before they cross IPC.
- **Logging:** use `log(level, msg, extra)` in `main.js`. It writes JSON lines to `app.log`. Never log secrets, CV text or contact details.
- **Dependencies:** each new one needs a reason the platform or stdlib can't meet. Ask the user first. Prefer what is already installed.

## Rules by area
**IPC**
- A new channel needs three things: the handler in `main.js`, its name in the `preload.js` allow-list, and validation of every argument (`str()`, clamps, regex for URLs).
- Never return secrets; return booleans for "key is set".

**Database**
- The schema is created idempotently (`CREATE ... IF NOT EXISTS`).
- Column additions are idempotent `ALTER TABLE` wrapped in try/catch, never a destructive migration.
- Enforce allowed values with `CHECK` constraints, not only in JS.
- Prune runs on every refresh: `new` or `hidden` jobs older than 30 days; recruiters still `new` or `ignored` after 90 days. Saved and applied jobs, and contacts you acted on, are kept.

**Sources**
- One failing source must never break the feed (`Promise.allSettled`); its status string says why.
- Every request has a timeout. Respect site rate limits: no tight loops, and spread wide searches over successive refreshes.
- Public search pages and official APIs only. Nothing that needs the user's login; see the hard constraints in `CLAUDE.md`.

**Matching**
- Every rule change comes with a test in `test/match.test.js`.
- Check every change against the real CV and real fetched jobs; compare the top 10 before and after.
- Prefer rules that generalise (section-aware parsing, word boundaries) over special cases for one CV.

**Security**
- Keep `contextIsolation`, `sandbox`, the webview hardening in `will-attach-webview`, and `setWindowOpenHandler` denying popups.
- CSP: no remote scripts and no inline scripts; `'unsafe-inline'` is for styles only, because the webview needs it.

## Definition of done
1. `npm test` is green, with a new test for any new logic branch.
2. The change is verified where it runs. Electron changes are checked in the running app via `scripts/cdp.mjs` or the app log, not only in Node.
3. No new hard-constraint violations. Ask `compliance-reviewer` when unsure.
4. Docs updated:
   - `SPEC.md` for behaviour or plan changes;
   - `PROJECT.md` for contracts or rules;
   - `CLAUDE.md` "Current state";
   - `README.md` for setup steps.
5. Anything not verifiable without a human (notifications, login persistence) is listed as such, not claimed.
