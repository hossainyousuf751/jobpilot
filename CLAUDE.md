# JobPilot: guidelines for Claude

Electron desktop app for one job seeker: reads their CV, pulls jobs from job sites, keeps the ones they are eligible for, alerts on new matches, embeds job portals, collects recruiters.

- **What and why:** `SPEC.md` (scope, assumptions, expansion plan).
- **How the code is built:** `PROJECT.md` (architecture, conventions, data rules, definition of done).
- **Agent roles:** `.claude/agents/` (when to delegate and to whom; see bottom of this file).

## Codebase map (graphify): check it before reading files
There is a knowledge graph of the code and docs in `graphify-out/`: 258 nodes, 14 labelled communities, file:line on every code node. Use it to find where something lives before opening whole files.
- **Orientation:** read `graphify-out/GRAPH_REPORT.md` (~8 KB) instead of skimming the source tree. It lists:
  - the communities (Renderer Core, CV Matching Engine, Main Process & Database, Job Sources & Insights Logic, Review Deck, Today Briefing, …);
  - the most connected functions (`h()`, `loadJobs()`, `renderDetail()`, `doRefresh()`, `scoreJob()`);
  - the cross-file links.
- **"Where/how does X work?":** run `graphify query "<question>" --budget 800`. It returns the relevant nodes with `src=file loc=Lnn`; then read only those line ranges. Use `graphify path "A" "B"` for how two parts connect and `graphify explain "<node>"` for one symbol.
- **After changing code:** run `graphify update .` to re-extract the changed code files (AST only, no LLM cost). After changing docs (`*.md`, `index.html`), run `/graphify . --update` (semantic re-extraction of just those files).
- **Exclusions:** `.graphifyignore` keeps `CV/` (personal data), `*.db` and `graphify-out/` out of the graph. Never remove the `CV/` line. `graphify-out/` is gitignored and rebuildable with `/graphify .`.
- **Interpreter:** graphify runs on the user's Python 3.11 (`pip install graphifyy`, 0.9.95). Set `GRAPHIFY_NO_AUTO_REFRESH=1` so CLI calls don't rewrite `~/.claude/skills/graphify`.
- **No auto-rebuild hook is installed;** the user hasn't approved one. Rebuild manually as above.

## How to work here
1. **Read before you change.** Trace the flow end to end (renderer → preload → IPC handler in `main.js` → `db`/`sources`/`match`) before editing.
2. **Smallest working change.** Use the `ponytail` skill: stdlib and platform first, no new dependency for what a few lines do, no abstractions for one caller. Mark deliberate shortcuts with `// ponytail: <ceiling>, <upgrade path>`.
3. **Thin slices.** Use `agent-skills` judgement: spec, then one slice, then verify, then the next. Plans live in `SPEC.md`, not in chat.
4. **Prove it in Electron.** "Works in Node" or "works in a browser stub" has hidden real bugs here twice. A UI or IPC change is done only after a check in the running app (see Verify).
5. **Report plainly.** Say what was verified and how, what was not, and what needs the user at the window.
6. **Ask before** commits, pushes, deleting user data (`%APPDATA%\jobpilot`), adding a dependency, or anything that sends the user's CV or contacts to a third party.

## Commands (Windows, PowerShell or Git Bash)
| Task | Command |
|---|---|
| Unit tests | `npm test` (`node --test`, must stay green) |
| Run app | `npm start` |
| Run app for headless checks | `node_modules\electron\dist\electron.exe . --remote-debugging-port=9333` |
| Evaluate JS in the window | `node scripts/cdp.mjs "<expr>"` (prints exceptions and console errors too) |
| Syntax check main | `node --check src/main.js` |
| Python source dependency | `pip install python-jobspy` (installed in the user's Python 3.11); `python src/jobspy_fetch.py --selftest` |

## Verify (pick what the change touches)
- **Matching / CV parsing:** add a case to `test/match.test.js`, then run the real CV: `CV/*.pdf` through `pdf-parse/lib/pdf-parse.js` and `buildProfile`. Compare the top 10 ranked jobs before and after.
- **Sources:** `sources.js` works in plain Node (it falls back to global `fetch`). Run `fetchAll(profile, {})` and print the per-source `status`. Expect JobSpy to take about 80 s.
- **Renderer / IPC:** start the app with the debug port, then `scripts/cdp.mjs` to read DOM state, click tabs and catch exceptions. Startup exceptions are replayed on connect.
- **Database:** copy `%APPDATA%\jobpilot\jobpilot.db` first, then open the copy with `src/db.js` from Node.
- **App log:** `%APPDATA%\jobpilot\app.log` (JSON lines, one `refresh` entry per poll with per-source status).

## Environment gotchas (each one cost real time)
- **Electron output:** `electron.exe` is a GUI program, so its stdout never reaches the shell. Write results to a file, or use CDP.
- **`ELECTRON_RUN_AS_NODE`:** it leaks between commands in one PowerShell session. Remove it before launching the app (`Remove-Item Env:ELECTRON_RUN_AS_NODE`).
- **Single-instance lock:** after killing the app, wait about 2 s before relaunching, or the new copy exits silently.
- **Corporate network:** it blocks Node's GitHub downloads and kills large downloads in `%TEMP%`. curl into the project folder works. pip and the job sites work.
- **Paths:** the project lives in OneDrive and the path has spaces; always quote it.
- **contextBridge `api`:** preload exposes `api` as a locked global. Never redeclare it in `src/ui/app.js`; a redeclaration is a SyntaxError that kills the whole UI.
- **`<webview>`:**
  - It needs `style-src 'unsafe-inline'` in the CSP.
  - A hidden webview drops its `src`, so load it when its tab is shown.
- **pdf.js:** it rejects with plain objects, not `Error`; wrap them before they reach the UI.
- **JobSpy countries:** it has no Indeed/Glassdoor country for Bangladesh, and `country_indeed` must use JobSpy's own spelling.

## Hard constraints (never trade these for features)
- **Never automate the user's own accounts.** No logged-in scraping, crawling, auto-connect or auto-apply on LinkedIn or any site. Public job-search pages via JobSpy are allowed: the user chose this on 2026-10-25, and no account is involved. Login-based scrapers (e.g. `linkedin_scraper`) were rejected for ban risk.
- **No bulk harvesting of people's profiles.** Recruiters come only from:
  - job data (descriptions, emails);
  - the hiring-team box on a page the user opened;
  - licensed APIs the user holds a key for.
- **External data is untrusted.** Job APIs, scraped pages and webviews are all untrusted. Render with `textContent` only, and validate and clamp in `main.js` before anything touches the DB.
- **Agent roles in `.claude/agents/` load only in a new session.** Until then, run a general-purpose agent told to read the role file.
- **Renderer stays locked down:** `contextIsolation`, `sandbox`, no Node in webviews, and the IPC allow-list in `preload.js`.
- **The user's CV and recruiter contacts are personal data.** Never commit them (`CV/` is gitignored). Never send them anywhere except a service the user configured.
- **Secrets** live only in `secrets.bin` (encrypted with `safeStorage`). Never log them or return them to the renderer.

## Current state (2026-10-25)
- **Running in Electron 45 and verified there:** feed, tabs, profile, Portals (LinkedIn loads), single-instance lock.
- **Sources:** JobSpy (LinkedIn, Indeed, Glassdoor, Bdjobs, Bayt), Remotive, Arbeitnow, RemoteOK. JSearch and Adzuna wait for keys.
- **Matching** is tuned on the user's CV: Data Analyst at Wall Street Docs, Dhaka; audit and finance background; 3 years of experience.
- **Expansion slices 1–5 done and verified in the running app (2026-10-25):** Dhaka plus one relocation country per refresh. A refresh fetched about 500 jobs in about 50 s, and the feed had 45 matches. Compliance review findings were all fixed.
- **Feed quality pass (2026-10-25):**
  - Gulf nationals-only and Emiratisation jobs are blocked.
  - Title words match by stem (auditor~audit); titles unrelated to the roles get −10.
  - Cross-site duplicates are merged in `listJobs` (`also`).
  - A refetch now keeps the fuller description (LinkedIn description fetches sometimes come back empty).
  - Stored jobs are re-scored at startup.
  - The rotation counter is seeded from the clock.
  - Result: the feed went from 41 to 35 jobs, with the off-topic and nationals-only entries gone.
- **Offline CV analysis (2026-10-26):** the user declined AI/API matching. The CV now gives `suggestedRoles` (Profile chips) and `cvTerms` (TF-IDF similarity, 25% of the score, "Strong/Weak CV fit" notes). Generic title words and sales titles no longer count as role matches, and all 5 roles are searched. Audit and financial-analyst roles entered the feed.
- **Job-site patterns (2026-10-26):** shipped job type and salary from all sources; Matches and All jobs share server-side search, filters and sort; a details pane beside the list; and a My jobs tracker (saved → applied → interview → offer/rejected). See the plan in `SPEC.md`. Bdjobs gives neighbourhood locations ("Mirpur"); the user can add those as extra on-site places.
- **UI redesign (2026-10-26):**
  - Fluent-style design system with light and dark themes.
  - Sidebar with counts and per-source sync health; overview tiles.
  - List and details pane with score-breakdown bars; J/K/S/H keyboard triage.
  - Drag-and-drop My jobs board; grouped alerts; recruiters table; stacked toasts; refresh progress via a `refreshing` IPC event.
  - Verified with CDP screenshots; conventions in `PROJECT.md` → UI design system.
- **2030 redesign (2026-10-26):** shipped all six slices of the 2030 vision in `SPEC.md`:
  - Today briefing as the home page, greeting by the name read from the CV;
  - Review deck (drag or arrow keys; `reviewed` flag, undo);
  - Ctrl+K command palette;
  - follow-up nudges (`stage_at`);
  - Insights (skill gaps, salary bands, daily matches, sources);
  - floating glass identity with a cobalt-to-teal brand gradient.

  Verified with CDP screenshots in both themes. The review test passed one job and undid it, restoring it exactly.
- **Scoring v2 (2026-10-26):** shipped the nine metrics, competitive notes and calibration from the user's decisions, with held-out AUC shown in Insights → Score accuracy.
  - Education is read from the CV's Education section only: a referee's "PhD Candidate" was being read as the user's degree.
  - The user's education is set to Master's (their MSc is in progress); they may want Bachelor's.
  - No expected salary is set yet, so the pay metric is idle.
  - Scores rose a little overall: a minimum of about 58 now gives the old feed size of 50.
  - Calibration has 1 decision and needs 20.
- **JSearch live (2026-10-26):** the user's OpenWebNinja key is saved encrypted in `secrets.bin`. Never write it to a file, a log or git.
  - The source picks the provider by key prefix (`ak_` = OpenWebNinja, `search-v2`, `X-API-Key` header) and sends the ISO `country` (the API defaults to "us").
  - It runs once every 4 refreshes (`JSEARCH_EVERY`, every 2 h): the quota is unknown, because there are no rate-limit headers.
  - Verified: "Data Analyst in Dhaka" gave 1 eligible job. Coverage for Bangladesh is thin.
- **public-apis review (2026-10-26):** the user shared github.com/public-apis/public-apis.
  - Added Currency-api (free, no key) for the pay metric's FX conversion; 175 of 181 salaried matches can now be pay-scored.
  - Recommended, but waiting for the user's free keys: Jooble (multi-country) and Reed (UK).
  - Rejected HeroHunt (bulk profile harvesting) and HireLayer (uploads the CV).
  - Offered next: World Bank PPP data so pay abroad reflects cost of living.
- **Jooble / Reed (2026-10-26):**
  - The user's Jooble key works only on the US site (country sites return 403 and there is no Bangladesh site), so it was not added or stored. They can get UAE/UK keys if they want it.
  - Reed is live; its key is encrypted in `secrets.bin`.
  - Reed details: UK-only, gated on the UK being in locations/relocate, every 2 h offset from JSearch, one search plus details for the top 10, location suffixed ", United Kingdom" (it is often a postcode), salary period from `salaryType`, HTML-decoded titles.
  - Applicant counts come from search `applications`: the details endpoint's `applicationCount` is always 0.
- **Control-character guard:** a test fails if any `src` file contains control characters. Generated edits had turned regex `` into backspace (broke the "temp" job type).
- **Next:** the user tests Hunter with a real key. Slice 6 (employer ATS boards) only if the user asks.
- **Not yet confirmed by a human:**
  - LinkedIn login persisting across restarts;
  - hiring-team capture on a LinkedIn job page;
  - the CV upload dialog.
- **Git:** `main` tracks the private GitHub repo `hossainyousuf751/jobpilot` (pushed 2026-10-26; `gh` is logged in). Ask before every commit or push.

## Delegating to agent roles
Delegate only when the work is independent or needs a fresh, unanchored read. Do a handful of tool calls yourself.

| Role | Use for |
|---|---|
| `source-engineer` | Adding or fixing a job or recruiter source (`sources.js`, `jobspy_fetch.py`) |
| `matching-engineer` | Changes to CV parsing, scoring or eligibility (`match.js`) |
| `app-verifier` | Checking a change in the running Electron app; read-only, reports evidence |
| `compliance-reviewer` | Reviewing a diff for ToS, privacy and security constraints before it is called done |
