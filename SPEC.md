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

## Layout
- `src/main.js` window, IPC, poller, notifications · `src/db.js` SQLite · `src/sources.js` job APIs
- `src/match.js` CV parsing → profile, job scoring · `src/recruiters.js` contact extraction
- `src/ui/` renderer · `test/` `node --test`

## Out of scope (add when needed)
Multi-user/server deployment, LLM-based matching, auto-apply, cloud sync.
