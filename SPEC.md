# JobPilot — spec

Desktop app (Electron) that finds jobs you are eligible for, based on your CV.

## Assumptions (correct me)
1. Single user, local-only. Data in SQLite under the app's userData folder; API keys encrypted with OS keychain (`safeStorage`).
2. **Job listings from public search pages only, never through the user's LinkedIn login.** JobSpy (Python, `pip install python-jobspy`) reads LinkedIn, Indeed, Glassdoor, Bdjobs and Bayt job searches without an account, so the user's account can't be banned. No profile scraping or auto-connecting (account-login scrapers like linkedin_scraper were rejected for that reason). Also: Remotive, Arbeitnow, RemoteOK (keyless), JSearch and Adzuna (optional keys).
3. "Eligible" = required years ≤ your years + 1, not an exec role you're far below, location/remote region matches where you can work, and no "no sponsorship / citizens only / clearance" clause if you need sponsorship.
4. Recruiters come from: emails/LinkedIn links inside job descriptions, the "Meet the hiring team" box on LinkedIn job pages you open in the Portals tab, and a per-company recruiter search. You click Connect yourself.

## Features / acceptance
- **Profile & CV**: upload PDF/DOCX/TXT → skills, years, target roles auto-extracted, all editable.
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

## Layout
- `src/main.js` window, IPC, poller, notifications · `src/db.js` SQLite · `src/sources.js` job APIs
- `src/match.js` CV parsing → profile, job scoring · `src/recruiters.js` contact extraction
- `src/ui/` renderer · `test/` `node --test`

## Out of scope (add when needed)
Multi-user/server deployment, LLM-based matching, auto-apply, cloud sync.
