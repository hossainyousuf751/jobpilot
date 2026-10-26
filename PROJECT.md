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
| `insights.js` | Pure: Today briefing (`briefing`) and market insights (`insights`, `parseSalary`) from job lists | Touch I/O or the DB |
| `recruiters.js` | Contact extraction; the hiring-team script for the viewed page | Navigate or crawl pages |
| `main.js` | IPC, validation, orchestration, OS integration | Hold scoring or parsing logic |
| `src/ui/*` | Rendering and user actions | Use `innerHTML` with data; call Node |

## Data contracts
**Normalised job** (every source returns exactly this):
`{ id, source, title, company, location, remote, url, description, posted_at }`
- `id` is `<source>:<native id>`, which must be stable across runs because it drives deduplication and alerts.
- `url` must be http(s); jobs without a title or a valid URL are dropped in `fetchAll`.
- Optional fields: `applicants` (integer, Reed only; validated in `main.js`; drives the "Few applicants" / "N applicants already" notes), `job_type` (comma list of fulltime, parttime, contract, internship, temporary; normalised by `jobType()` in `fetchAll`, validated in `main.js`), `salary` (display string such as "BDT 25,000-40,000 / month", ≤ 60 chars), `emails` (addresses the site listed; turned into recruiters) and `company_url` (the employer's own website, never a job board page; validated in `main.js`, used for Hunter.io). Document any new ones here.

**Profile** (stored as JSON in `profile`, defaults in `main.js` `DEFAULT_PROFILE`):
- `skills[]`, `years`, `roles[]` (search queries, max 5, all searched in turn), `suggestedRoles[]` (inferred from the CV, shown as chips, never applied silently), `cvTerms{}` (term counts from the CV's experience/skills sections, used for TF-IDF similarity; the CV text itself is not stored), `locations[]` (on-site, "City, Country"; first one is searched), `education` (1-4, null = not set), `expectedSalary` ({amount, currency, period} or null), `calibration` (computed, not user-edited), `distanceKm`, `relocate[]` (countries, one searched per refresh), `remoteFrom[]` (regions), `needsSponsorship`, `minScore`, `adzunaCountry`, `cvFile`.
- New fields need a default in `DEFAULT_PROFILE`, clamping in `saveProfile`, and a form field in `index.html`.

**Score result:** `{ score: 0–100, eligible, reasons: { matched, missing, notes, blockers } }`. **Scoring v2:**
- **The nine metrics** in `reasons.parts`, each 0-100 or null when there is no evidence: skills, title, experience, cv, edge, seniority, education, pay, freshness.
- **Score** = weighted mean over the non-null metrics (`combine`), minus penalties: −10 for an unrelated title, −20 for a sales title. Missing evidence never counts as 0.
- **Weights:** `PRIOR_WEIGHTS` until `calibrate(db.decisions())` has at least 20 decisions with at least 5 kept and 5 dropped. Then learned logistic-regression weights, blended with the priors (at most 70% learned), stored in `profile.calibration` with held-out AUCs (prior vs learned).
- **Recalibration** happens in `rescoreAll()` at startup and after each refresh.
- **Competitive notes:** pays ±15% vs the market median (`corpus.payMedian`, per currency and period, at least 5 salaries), rare-skill match (under 5% of jobs), posted today.
- **FX:** pay converts other currencies with daily Currency-api rates (`fetchRates`, cached in userData `fx.json`, re-fetched once a day; stale rates are used if the fetch fails). Rates are nominal, with no cost-of-living adjustment. Market medians stay per currency. Any blocker means the job is ineligible. Notes are shown to the user, never silently dropped.

## Conventions
- **Plain stack:** CommonJS, no build step, no framework, no TypeScript. Two-space indent, single quotes, semicolons. Match the surrounding code.
- **Comments say why, not what.** One line, above the code it explains. Deliberate shortcuts get `// ponytail: <limit>, <upgrade path>`.
- **DOM:** build it with the `h()` helper in `app.js`. Text always goes through `textContent`. No inline event attributes (the CSP forbids inline scripts).
- **Errors:**
  - Handlers throw `Error` with a user-readable message; the renderer's `guard()` shows it as a toast.
  - Convert non-`Error` rejections, as pdf.js produces, before they cross IPC.
- **Logging:** use `log(level, msg, extra)` in `main.js`. It writes JSON lines to `app.log`. Never log secrets, CV text or contact details.
- **Dependencies:** each new one needs a reason the platform or stdlib can't meet. Ask the user first. Prefer what is already installed.

## UI design system (`src/ui/style.css`)
- **Files:** `app.js` holds the core (DOM helpers, navigation, feed, board, alerts, recruiters, profile); one file per newer view: `today.js`, `review.js`, `insights-view.js`, `palette.js`. Shared globals; startup runs on `DOMContentLoaded`, after all of them load.
- **2030 layer:** floating translucent panels, `--brand` gradient only for brand, primary action and progress; view transitions on page switches (skipped while hidden); the review deck uses pointer events with a spring-back transition.
- **Charts:** colours from `--series-have` / `--series-gap` (validated with the dataviz skill's `validate_palette.js`, light and dark); identity is never colour-only (legend + icon + text); every mark has a `tipOn` tooltip.
- **Tokens only:** colors (`--surface`, `--text-2`, `--accent`, `--success-soft`…), spacing `--s1`…`--s8` (a 4px grid), radii `--r-sm/--r/--r-lg` (4/6/8px). No raw hex or off-scale pixels in new rules. Every token has a dark value under `prefers-color-scheme: dark`; check both themes.
- **Look:** Fluent-leaning neutrals and one blue accent; 1px borders; shadows only on floating layers (toasts, popovers, the narrow-width drawer). No gradients except the score ring.
- **Building blocks** in `app.js`:
  - `h()` for DOM (`vars: {p: 80}` sets CSS custom properties) and `icon(name)` for the SVG sprite in `index.html`;
  - `btn()`, `iconBtn()` (always with an aria-label), `ring()`, `avatar()`, `emptyState()`, `toast(msg, 'success'|'error'|'info')`.
- **Every list needs a loading (skeleton), empty (`emptyState`) and error (`guard` → toast) state.**
- **`replaceChildren()` takes a flat list of nodes;** build groups with spreads, never nested arrays or `cond && node` (renders `0` or `[object …]`).
- **Keyboard:** J/K, S, H, Enter and / on the feed; anything clickable is a `<button>` or has `tabindex` plus an Enter handler.
- **Visual check:** start the app with the debug port and capture `Page.captureScreenshot` over CDP at 1440×900 and 1024×760, in dark and light (`Emulation.setEmulatedMedia`).

## Rules by area
**IPC**
- A new channel needs three things: the handler in `main.js`, its name in the `preload.js` allow-list, and validation of every argument (`str()`, clamps, regex for URLs).
- Never return secrets; return booleans for "key is set".

**Database**
- The schema is created idempotently (`CREATE ... IF NOT EXISTS`).
- Column additions are idempotent `ALTER TABLE` wrapped in try/catch, never a destructive migration.
- Enforce allowed values with `CHECK` constraints, not only in JS.
- Jobs table also holds `job_type`, `salary` and `stage` (applied → interview → offer → rejected; only set while `status = 'applied'`, cleared by any other status).
- `listJobs(filters)` builds its WHERE clause from validated filters only (`main.js` whitelists every enum and clamps strings); values always go in as parameters.
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
