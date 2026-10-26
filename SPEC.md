# JobPilot — spec

Desktop app (Electron) that finds jobs you are eligible for, based on your CV.

## Assumptions (correct me)
1. Single user, local-only. Data in SQLite under the app's userData folder; API keys encrypted with OS keychain (`safeStorage`).
2. **Job listings from public search pages only, never through the user's LinkedIn login.** JobSpy (Python, `pip install python-jobspy`) reads LinkedIn, Indeed, Glassdoor, Bdjobs and Bayt job searches without an account, so the user's account can't be banned. No profile scraping or auto-connecting (account-login scrapers like linkedin_scraper were rejected for that reason). Also: Remotive, Arbeitnow, RemoteOK (keyless), JSearch and Adzuna (optional keys).
3. "Eligible" = required years ≤ your years + 1, not an exec role you're far below, location/remote region matches where you can work, and no "no sponsorship / citizens only / clearance" clause if you need sponsorship.
4. Recruiters come from: emails/LinkedIn links inside job descriptions, the "Meet the hiring team" box on LinkedIn job pages you open in the Portals tab, and a per-company recruiter search. You click Connect yourself.

## Features / acceptance
- **Profile & CV**: upload PDF/DOCX/TXT → skills, years, target roles auto-extracted, all editable. Offline CV analysis (user chose no AI on 2026-10-26): roles inferred from CV content are suggested, and each job's text is compared with the CV's experience/skills sections (TF-IDF). Nothing leaves the PC.
- **Live feed**: polls every 30 min (and on demand), scores 0–100 with matched/missing skills and blockers; feed updates without reload.
- **Alerts**: new eligible jobs ≥ min score → OS notification + Alerts tab with unread count.
- **Portals**: in-app browser (persistent login) for LinkedIn/Indeed/Glassdoor; job links open there.
- **Recruiters**: people list with status (new/requested/connected/ignored) + companies hiring for your profile.

## Expansion plan (2026-10-25)
Each slice ships with a test or a live check.
1. ✅ **Profile "where"** — `locations` = on-site places as "City, Country" + `distanceKm`; `relocate` = countries you'd move to; `remoteFrom` = regions a remote job may be limited to.
2. ✅ **Search targets** — every refresh searches home; one relocation country and one search term per refresh, round-robin (keeps a refresh to ~1 min and LinkedIn under its rate limit; home gets each term every 3 refreshes; every country × term pair is covered every terms × countries refreshes, i.e. 18 refreshes = 9 h for 3 roles and 6 countries). Sites per country: LinkedIn always, Indeed/Glassdoor where JobSpy supports the country, Bdjobs for Bangladesh, Bayt for Gulf/MENA.
3. ✅ **Eligibility** — job is OK if in an on-site city, in a relocate country (then sponsorship or nationals-only wording in title/description is a blocker, a visa is assumed), remote open to a `remoteFrom` region, or worldwide.
4. ✅ **Recruiters from job data** — keep JobSpy's `emails` and the employer's own `company_url`; emails become recruiters; untouched contacts pruned after 90 days.
5. ✅ **Hunter.io (optional key)** — per hiring company, "Find HR contacts" button → HR-department emails. Uses the employer domain when known (~8% of jobs), else a company-name search accepted only if Hunter's matched organisation is the same company. Key sent as `X-API-KEY` header.
6. **Employer ATS boards** (Greenhouse/Lever/Ashby) — later; few Bangladeshi employers use them.

## Job-site patterns plan (2026-10-26)
What LinkedIn, Indeed, Glassdoor, Bdjobs and Bayt have in common, and what JobPilot adopts.

**Adopted, in slices (each with a test or a live check):**
1. ✅ **Job facts.** Store and show `job_type` (fulltime, parttime, contract, internship, temporary) and a `salary` display string from every source that has them, plus "posted X ago" from `posted_at`. Indeed, Bdjobs and Bayt return salaries; LinkedIn returns neither field.
2. ✅ **All jobs feed + search/filter/sort.**
   - A new "All jobs" tab lists every stored job, with no score or eligibility filter (ineligible jobs show their blockers).
   - "Matches" (the old Live feed) keeps the eligible, score ≥ min view.
   - Both views share one bar, run server-side:
     - keyword (title, company, description) and location;
     - date posted (24 h, 3 d, 7 d, 30 d);
     - workplace (remote or on-site), job type, and salary-listed only;
     - sort by best match or newest.
3. ✅ **Split view.** Clicking a job shows its full details beside the list:
   - description, facts and match reasons;
   - actions: open in Portals, open externally, save, apply, hide.
4. ✅ **My jobs tracker.** Saved → Applied → Interview → Offer / Rejected; a stage per applied job, and a tab grouping them.

**Not adopted (and why):**
- Company reviews and salary insights: no data source.
- One-click apply: automates the user's accounts, which is a hard constraint.
- Applicant counts: not exposed.
- Saved searches with their own alerts: alerts already follow the profile; add when asked.

## 2030 vision (2026-10-26)
The user liked the My jobs board because it is spatial, tactile and action-first. That is the principle for everything else: **you act on things, you don't scroll lists of them.**

**Qualities a 2030 job app has:**
1. **Proactive, not passive.** It opens on a briefing: what changed since you last looked and what to do next (follow-ups that are due, interviews, fresh strong fits). Lists are a fallback, not the home.
2. **Direct manipulation everywhere.** Triage is a deck you flick (pass, save, apply), the pipeline is a board you drag, and every action is one gesture or one key.
3. **Command-first.** Ctrl+K reaches any job, page or action. Power users never touch the mouse.
4. **Explainable intelligence.** Every number shows its reasons: score parts, skill gaps against the market, salary bands. Insight comes from your own data, computed on the device.
5. **Calm and spatial UI.** Floating layered panels, depth through translucency rather than borders, motion that explains state changes (view transitions, spring physics). The brand gradient is used only where it means something: fit, progress, the primary action.
6. **Private by design, visibly.** Everything is local, and the UI says so.
7. **Time-aware.** It knows when you applied and nudges you to follow up; it shows trends over days, not just snapshots.

**Slices (each with a test or a screenshot check):**
1. ✅ **Identity 2.0:** floating-panel layout, translucent sidebar, brand gradient, view transitions between pages.
2. ✅ **Today:** a briefing home with since-last-visit numbers, next actions, a mini pipeline and the top fresh fits.
3. ✅ **Review deck:** flick through unreviewed matches one card at a time (drag or ← → ↑). Adds a `reviewed` flag.
4. ✅ **Command palette (Ctrl+K):** jobs, pages and actions.
5. ✅ **Follow-ups:** `stage_at` timestamps; "applied 9 days ago, follow up" on the board and in Today.
6. ✅ **Insights:** skills the market wants versus yours, salary bands, new matches per day, source mix.

## Scoring matrix v2 (2026-10-26) ✅ shipped
The user asked for more metrics so that the score is accurate. More metrics alone don't make a score accurate; measuring it against the user's own decisions does. So this plan has three parts.

**1. Nine metrics, each 0-100.** A metric with no evidence is left out of the average rather than counted as 0.

| Metric | Measures | Prior weight |
|---|---|---|
| Skills | Share of the job's skills you have. Required skills count fully; "preferred / nice to have" skills count half. | 25 |
| Role fit | Title vs your target roles (stems; generic words ignored) | 20 |
| Experience | Years asked vs yours, graded: one year short scores 60, not a cliff | 12 |
| CV similarity | TF-IDF of your experience/skills text vs the posting | 13 |
| Skill edge | Rarity-weighted coverage: matching rare skills (Structured Products) beats matching common ones (Accounting) | 10 |
| Seniority | Title level (intern … head) vs the level your years suggest | 6 |
| Education | Degree the job asks for vs yours | 5 |
| Pay | Listed salary vs your expected salary, other currencies converted at daily rates (Currency-api) | 5 |
| Freshness | Days since posting; early applicants get read | 4 |

**2. Competitive signals,** shown as notes:
- pay above or below the market median for that currency and period;
- a rare-skill match;
- "posted today, apply early".

**3. Calibration from your decisions.**
- **Labels:** saved or applied = positive; passed or hidden = negative.
- **Learning:** once there are at least 20 decisions with at least 5 of each kind, a logistic regression on the metric vector learns personal weights. These are blended with the priors in proportion to how much data exists (at most 70% learned).
- **Accuracy:** the app reports agreement (AUC: how often a job you kept outranks one you dropped). It is measured on half the decisions held out from training, for both the prior weights and the learned weights, and shown in Insights.

## Documents: CV builder and cover-letter studio (2026-10-26)
Two new sections under "Documents". Everything stays local; PDFs are made by Electron's own `printToPDF`, with no new dependency.

**CV builder (FlowCV-style):**
- **Layout:** editor on the left, live A4 preview on the right; several CVs (create, duplicate, rename, delete); autosave.
- **Content tab:**
  - Personal details: name, job title, email, phone, location, links.
  - Sections you can add, hide, rename, collapse and drag to reorder: profile (text); experience, education, projects, courses/certificates, publications, references, custom (entries); skills, languages (tags with optional level).
  - Entries: title, subtitle, location, start/end or "present", and bullet description. Reorder by drag or ↑↓.
- **Customize tab:**
  - Templates (Classic, Modern, Executive, Compact) as presets of the controls below.
  - Layout: one column, or two columns with a sidebar left or right.
  - Header alignment; heading style (underline, box, accent bar, plain); accent colour; font family; font size, line height, margins, section spacing; date position.
- **Import from my CV:** parses a PDF, DOCX or TXT into sections and entries (heuristic; you edit the result).
- **Download PDF:** A4, via a hidden, script-disabled window and `printToPDF`.

**Cover-letter studio (creative brief):**
- **Job-aware:** pick a job from your feed. The letterhead, company, role and the job's skills fill in automatically.
- **Structure:** draft from blocks (Hook, Why this company, Why me, Proof, Close). Choose a tone (Formal, Confident, Warm) and regenerate any block; edit freely.
- **Evidence picker:** your CV's experience bullets, one click to cite as proof.
- **Coach panel:**
  - keyword coverage (which of the job's skills the letter mentions; click a missing one to add it);
  - length target (250-400 words);
  - "you vs I" balance (letters that talk about the employer read better);
  - average sentence length.
- **Matching set:** the letter uses the chosen CV's design and personal details.
- **Download PDF.**

## Going online: JobPilot for up to 15 testers (plan, 2026-10-27)
**Goal:** people create an account, log in, upload their CV and get matched jobs in a browser. Testing phase: invite-only, at most 15 users.

**Architecture (reuse, don't rewrite):**
- **Server:** `src/server.js` on `node:http`. It serves `src/ui/` as static files and exposes each of the current IPC calls (33 of them) as `POST /api/<name>`. A small `src/ui/api.js` replaces `preload.js` with `fetch`, so the UI code barely changes. No web framework or new npm dependency is needed: `node:http`, `node:crypto` and `node:sqlite` cover it. The Electron app keeps working from the same code.
- **Accounts:**
  - Invite-only sign-up: the admin creates an invite link. Email and password, hashed with `crypto.scrypt`.
  - Sessions in an HttpOnly, Secure, SameSite=Strict cookie. Login is rate-limited.
  - A hard cap of 15 users.
  - Admin page: invite, list users, reset a password, delete a user.
- **Data isolation:** one SQLite file per user (`data/users/<id>.db`, the current schema unchanged) plus `data/server.db` (users, sessions, invites, shared job pool). A request only ever receives its own user's database, so one user's data can't leak to another through a missed `WHERE user_id`.
- **CV upload:**
  - The PDF or DOCX is parsed in memory (5 MB cap, type check).
  - Only the derived profile and the CV documents are stored, never the original file; that matches today's rule.
  - "Delete my account" removes the user's database file.
- **Job fetching becomes a shared scheduler:**
  - The server collects the distinct (role, location) searches across all users and runs each one at most every 3-4 h. It shares the raw results, and each user's jobs are scored against their own profile.
  - Fifteen users polling every 30 minutes from one data-centre IP would get LinkedIn and Indeed to block the server quickly.
- **Paid APIs (JSearch, Reed, Hunter):** the keys live in the server's environment, owned by the admin. Quotas are shared, so there's a per-user daily cap on Hunter lookups.
- **Features that work differently on the web:**
  - **Desktop notifications:** become in-app alerts. An email digest comes later.
  - **PDF export:** becomes the browser's print → Save as PDF, using the same `doc.css`.
  - **Portals tab:** sites forbid being embedded in a web page, so it becomes links that open in a new tab.
  - **Hiring-team capture from a LinkedIn page:** dropped on the web; it would need a browser extension.
  - **`safeStorage`:** replaced by server environment variables.
- **Phones:** the UI is desktop-first, and testers will use phones, so it needs a responsive pass.

**Hosting: free, with no credit card (the user's constraint, 2026-10-27).** Oracle was ruled out because it needs a card. This replaces the "Server" approach above. There is no server of our own:
- **UI:** static files on GitHub Pages, which needs a public repo on the free plan. Cloudflare Pages is the alternative if the code must stay private.
- **Accounts and data: Supabase free plan, no card needed.**
  - Built-in email/password auth (confirmation and reset emails included).
  - Postgres with row-level security, so each user reads only their own rows.
  - Limits: 500 MB of database. A project pauses after 7 days with no activity; the scheduled fetch keeps it awake.
- **In the browser:** `match.js` (already pure JS) does the scoring. CV parsing also runs in the browser (pdf.js, mammoth), so the CV file never leaves the user's device; only the derived profile and the CV documents are saved.
- **Job fetching:** a scheduled Supabase Edge Function calls the job APIs (Remotive, Arbeitnow, RemoteOK, JSearch, Reed) every 3-4 h for the distinct searches across users. Keys are kept as function secrets.
  - JobSpy (LinkedIn, Indeed, Bdjobs, Bayt) is Python and can't run there.
  - The option for it is a GitHub Actions cron. That's a grey area under the Actions terms (use unrelated to the repo's software), and LinkedIn blocks data-centre IPs. Decision pending.
- **PDF:** the browser's print. **Portals:** links that open a new tab.
- **The desktop Electron app stays as it is.**
- **New dependencies (need approval):** `@supabase/supabase-js`, pdf.js and mammoth's browser build, all vendored as files.

**Superseded hosting option, kept for reference (needs a card):**
- **Primary:** an Oracle Cloud Always Free Ampere A1 VM in Singapore. Since June 2026 it gives 2 OCPU and 12 GB, plenty for 15 users. It runs Node 24 and Python 3.11 (for JobSpy) on a persistent disk.
- **Caveats:**
  - Sign-up needs a card to verify identity.
  - "Out of capacity" errors happen; retry, or use the free E2.1.Micro (1 GB) as a fallback.
  - Instances idle for 7 days may be reclaimed; a nightly backup off the server covers this.
- **Fallback:** a spare home PC (not the work laptop) with a free Cloudflare Tunnel.
- **Ruled out:** Render and Koyeb free tiers sleep and have no persistent disk; Fly has no free tier.
- **Around the server, all free:**
  - Caddy for HTTPS;
  - a DuckDNS subdomain;
  - a systemd service;
  - a nightly backup of `data/`;
  - an UptimeRobot check;
  - Brevo for email later.

**Security and privacy:**
- HTTPS only; the existing CSP; an Origin check on every `POST`; authorisation on every call.
- Upload limits; logs with no personal data.
- A short privacy notice and consent at sign-up; account deletion; a "Report a problem" button.
- CVs are personal data. Only the admin can reach the server, and backups are encrypted.

**Slices for the free stack (each one verified before the next):**
1. ✅ **Web build (2026-10-27):**
   - `scripts/build-web.mjs` turns the desktop UI into `web-dist/`. `src/web/webapi.js` provides the same `api` on Supabase, with sign-in, invite codes and an account card.
   - CVs are read in the browser with pdf.js and mammoth; the real CV gives the same profile as the desktop.
   - Print-to-PDF, and portals open in new tabs.
   - Verified in headless Edge: the sign-in gate renders, with no console errors.
2. ✅ **Database:** `supabase/migrations/20261027000000_jobpilot.sql`: the pool, per-user tables, row-level security, invites (15 codes, 15-user cap), `delete_me`, `upsert_pool`/`prune_pool`. Waiting for the user to apply it.
3. ✅ **Fetcher:** `supabase/functions/fetch-jobs/index.ts`, generated from `sources.js`, `match.js` and `src/web/fetcher.js`.
   - Handles 3 users per hourly run, with a 50-minute minimum gap. It also refreshes exchange rates and the scoring corpus.
   - Verified in Node against the real APIs with Supabase faked: 409 jobs, corpus and FX stored, the second call skipped.
4. **Go live:**
   - Apply the schema and deploy the function through the GitHub integration;
   - set the function secrets;
   - add the pg_cron schedule;
   - Cloudflare Pages: build `node scripts/build-web.mjs`, output `web-dist`;
   - an end-to-end check with a test account.
5. **Mobile layout:** a responsive pass, plus a PWA manifest.
6. **Launch:** 3 testers first, then up to 15; collect feedback and fix.

**Needs from the user:**
- A Supabase free account (Singapore region) and its project URL and keys.
- A choice: make the repo public (GitHub Pages) or keep it private (Cloudflare Pages).
- A choice: run JobSpy in GitHub Actions (grey area), or go APIs-only online.
- Testers' emails.
- Confirmation that the JSearch, Reed and Hunter plans allow use for several people.
- A check that hosting other people's CVs is fine with their employer, because this project runs on a work laptop and OneDrive.

## Layout
- `src/main.js` window, IPC, poller, notifications · `src/db.js` SQLite · `src/sources.js` job APIs
- `src/match.js` CV parsing → profile, job scoring · `src/recruiters.js` contact extraction
- `src/ui/` renderer · `test/` `node --test`

## Out of scope (add when needed)
Public sign-up beyond the 15 testers, LLM-based matching, auto-apply, cloud sync.
