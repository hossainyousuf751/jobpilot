// Job sources. Each returns normalized jobs:
// { id, source, title, company, location, remote, url, description, posted_at } + optional job_type, salary, emails, company_url

// Job type words from any source → comma list of: fulltime, parttime, contract, internship, temporary.
const TYPES = [['fulltime', /full.?time|permanent/i], ['parttime', /part.?time/i], ['contract', /contract|freelance/i],
  ['internship', /intern/i], ['temporary', /temporary|temp\b|seasonal/i]];
const jobType = (raw) => TYPES.filter(([, re]) => re.test(String(raw || ''))).map(([t]) => t).join(',') || null;

// "USD 50,000-70,000 / year" from numeric fields; null when there is no amount.
const PERIOD = { YEAR: 'year', YEARLY: 'year', MONTH: 'month', MONTHLY: 'month', HOUR: 'hour', HOURLY: 'hour', WEEK: 'week', DAY: 'day' };
function salaryText(lo, hi, currency, period) {
  const n = (x) => (Number(x) > 0 ? Math.round(Number(x)).toLocaleString('en-US') : '');
  const amount = n(lo) && n(hi) && n(lo) !== n(hi) ? `${n(lo)}-${n(hi)}` : n(lo) || n(hi);
  if (!amount) return null;
  const per = period ? ` / ${PERIOD[String(period).toUpperCase()] || String(period).toLowerCase()}` : '';
  return `${currency ? `${currency} ` : ''}${amount}${per}`;
}

const text = (html = '') => html.replace(/<(br|\/p|\/li|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// In Electron use Chromium's stack: honours system proxy and corporate root certs.
// Resolved per call (not at load) so tests can stub global fetch.
const doFetch = (...a) => (globalThis.process?.versions?.electron ? require('electron').net.fetch : fetch)(...a);

async function get(url, headers = {}) {
  const res = await doFetch(url, { headers: { 'User-Agent': 'JobPilot/1.0 (personal job search)', ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Home every refresh plus one relocation country in turn: wider reach without bursting site rate limits.
function searchTargets(p, tick) {
  const home = { location: p.locations?.[0] || '' };
  const relocate = p.relocate || [];
  return relocate.length ? [home, { location: relocate[tick % relocate.length] }] : [home];
}

// ponytail: quota unknown (no rate-limit headers), so OpenWebNinja JSearch runs every 4th refresh = every 2 h (~360 calls/month);
// raise or lower once the plan's limit is known.
const JSEARCH_EVERY = 4;
// Reed (UK, public-apis list): same 2-hour pacing, offset by 1 h from JSearch; details for the top results only.
const REED_EVERY = 4, REED_OFFSET = 2, REED_DETAILS = 10;
const UK_RE = /\b(uk|united kingdom|england|scotland|wales|london|britain)\b/i;
const REED_PERIOD = { 'per annum': 'year', 'per month': 'month', 'per week': 'week', 'per day': 'day', 'per hour': 'hour' };
const ddmmyyyy = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : s || ''; };
// JSearch filters by ISO country and reports job_country as a code; the matcher needs names.
const ISO = { bangladesh: 'bd', 'united arab emirates': 'ae', uae: 'ae', 'saudi arabia': 'sa', ksa: 'sa', qatar: 'qa', singapore: 'sg', malaysia: 'my',
  'united kingdom': 'gb', uk: 'gb', 'united states': 'us', usa: 'us', india: 'in', pakistan: 'pk', kuwait: 'kw', oman: 'om', bahrain: 'bh' };
const isoCountry = (place) => ISO[String(place || '').split(',').pop().trim().toLowerCase()] || null;
const NAME = { bd: 'Bangladesh', ae: 'United Arab Emirates', sa: 'Saudi Arabia', qa: 'Qatar', sg: 'Singapore', my: 'Malaysia', gb: 'United Kingdom',
  us: 'United States', in: 'India', pk: 'Pakistan', kw: 'Kuwait', om: 'Oman', bh: 'Bahrain' };
const countryName = (code) => NAME[String(code || '').toLowerCase()] || code;

// JobSpy (Python) reads public job search pages; no account login, so no account-ban risk.
// Which sites run for which country is decided in jobspy_fetch.py (it knows JobSpy's country list).
function runJobspy(args) {
  const { execFile } = require('node:child_process');
  const script = require('node:path').join(__dirname, 'jobspy_fetch.py');
  return new Promise((resolve, reject) => {
    const child = execFile(process.env.JOBPILOT_PYTHON || 'python', [script], { timeout: 5 * 60000, maxBuffer: 64 << 20, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(err.code === 'ENOENT' ? 'Python not found: install Python 3, then pip install python-jobspy'
          : stderr.trim().split('\n').pop() || err.message));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('JobSpy returned unreadable output')); }
      });
    child.stdin.end(JSON.stringify(args));
  });
}

const SOURCES = {
  async jobspy(qs, p, _s, tick = 0) {
    // One search term per refresh; the relocation country advances after every term was used with it.
    const { jobs, errors } = await runJobspy({ terms: [qs[tick % qs.length]], targets: searchTargets(p, Math.floor(tick / qs.length)), distance_miles: Math.round((p.distanceKm || 50) / 1.609),
      hours_old: 168, results: 15 });
    const failed = Object.entries(errors);
    if (!jobs.length && failed.length) throw new Error(failed.map(([s, e]) => `${s}: ${e}`).join('; '));
    jobs.note = failed.length ? `failed: ${failed.map(([s]) => s).join(', ')}` : '';
    return jobs;
  },

  // UK jobs from Reed, with applicant counts. Only runs when the UK is somewhere you'd work.
  async reed(qs, p, s, tick = 0) {
    if (!s.reedKey) return null;
    const none = (note) => Object.assign([], { note });
    if (![...(p.locations || []), ...(p.relocate || [])].some((l) => UK_RE.test(l))) return none('UK not in your locations');
    const phase = (tick - REED_OFFSET + REED_EVERY * 1000) % REED_EVERY;
    if (phase) return none(`next search in ${(REED_EVERY - phase) * 30} min`);
    const auth = { Authorization: `Basic ${Buffer.from(`${s.reedKey}:`).toString('base64')}` };
    const q = qs[Math.floor(tick / REED_EVERY) % qs.length];
    const found = await get(`https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(q)}&resultsToTake=25`, auth);
    const jobs = [];
    // Full details one at a time (search results only carry a ~450-character snippet).
    for (const r of (found.results || []).slice(0, REED_DETAILS)) {
      const d = await get(`https://www.reed.co.uk/api/1.0/jobs/${encodeURIComponent(r.jobId)}`, auth).catch(() => null);
      if (!d) continue;
      jobs.push({ id: `reed:${d.jobId}`, source: 'Reed', title: text(d.jobTitle), company: text(d.employerName),
        location: `${d.locationName || ''}, United Kingdom`.replace(/^, /, ''), remote: /remote|work from home/i.test(`${d.jobTitle} ${d.locationName}`) ? 1 : 0,
        url: d.jobUrl || d.externalUrl, description: text(d.jobDescription), posted_at: ddmmyyyy(d.datePosted),
        job_type: [d.contractType, d.fullTime ? 'full time' : '', d.partTime ? 'part time' : ''].filter(Boolean).join(','),
        salary: salaryText(d.minimumSalary, d.maximumSalary, d.currency || 'GBP', REED_PERIOD[String(d.salaryType || '').toLowerCase()]),
        // The search result's count is real; the details endpoint's applicationCount is always 0 (checked 2026-10-26).
        applicants: Number.isInteger(r.applications) ? r.applications : null });
    }
    jobs.note = `searched “${q}” in the UK`;
    return jobs;
  },

  async remotive(qs) {
    const out = [];
    for (const q of qs) {
      const d = await get(`https://remotive.com/api/remote-jobs?limit=50&search=${encodeURIComponent(q)}`);
      for (const j of d.jobs) out.push({ id: `remotive:${j.id}`, source: 'Remotive', title: j.title, company: j.company_name,
        location: j.candidate_required_location, remote: 1, url: j.url, description: text(j.description), posted_at: j.publication_date,
        job_type: j.job_type, salary: j.salary || null });
    }
    return out;
  },

  // No search param; returns the newest postings, the scorer filters them.
  async arbeitnow() {
    const d = await get('https://www.arbeitnow.com/api/job-board-api');
    return d.data.map((j) => ({ id: `arbeitnow:${j.slug}`, source: 'Arbeitnow', title: j.title, company: j.company_name,
      location: j.location, remote: j.remote ? 1 : 0, url: j.url, description: text(j.description), posted_at: new Date(j.created_at * 1000).toISOString(),
      job_type: (j.job_types || []).join(',') }));
  },

  async remoteok() {
    const d = await get('https://remoteok.com/api');
    return d.filter((j) => j.id && j.position).map((j) => ({ id: `remoteok:${j.id}`, source: 'RemoteOK', title: j.position, company: j.company,
      location: j.location, remote: 1, url: j.url, description: text(j.description), posted_at: j.date,
      salary: salaryText(j.salary_min, j.salary_max, 'USD', 'year') }));
  },

  // LinkedIn / Indeed / Glassdoor / ZipRecruiter listings via JSearch, from either provider:
  // OpenWebNinja (keys start "ak_") or RapidAPI. One search per call; OpenWebNinja is paced (see JSEARCH_EVERY).
  async jsearch(qs, p, s, tick = 0) {
    if (!s.jsearchKey) return null;
    const owl = s.jsearchKey.startsWith('ak_');
    if (owl && tick % JSEARCH_EVERY) { const none = []; none.note = `next search in ${(JSEARCH_EVERY - (tick % JSEARCH_EVERY)) * 30} min`; return none; }
    // Rotate role × place across runs: home and one relocation country, like JobSpy.
    const run = owl ? Math.floor(tick / JSEARCH_EVERY) : tick;
    const targets = searchTargets(p, Math.floor(run / (2 * qs.length)));
    const place = targets[run % targets.length].location;
    const q = qs[Math.floor(run / targets.length) % qs.length] + (place ? ` in ${place}` : '');
    const iso = isoCountry(place);
    const d = owl
      ? await get(`https://api.openwebninja.com/jsearch/search-v2?query=${encodeURIComponent(q)}&date_posted=week${iso ? `&country=${iso}` : ''}`, { 'X-API-Key': s.jsearchKey })
      : await get(`https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&page=1&num_pages=1&date_posted=week${iso ? `&country=${iso}` : ''}`,
        { 'X-RapidAPI-Key': s.jsearchKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' });
    const jobs = (Array.isArray(d.data) ? d.data : d.data?.jobs || []).map((j) => ({ id: `jsearch:${j.job_id}`, source: j.job_publisher || 'JSearch',
      title: j.job_title, company: j.employer_name,
      location: j.job_location || [j.job_city, j.job_state, countryName(j.job_country)].filter(Boolean).join(', ') || (j.job_is_remote ? 'Remote' : ''),
      remote: j.job_is_remote ? 1 : 0, url: j.job_apply_link, description: j.job_description, posted_at: j.job_posted_at_datetime_utc,
      job_type: j.job_employment_type, salary: salaryText(j.job_min_salary, j.job_max_salary, j.job_salary_currency, j.job_salary_period),
      company_url: j.employer_website || null }));
    jobs.note = `searched “${q}”`;
    return jobs;
  },

  async adzuna(qs, p, s) {
    if (!s.adzunaId || !s.adzunaKey) return null;
    const country = (p.adzunaCountry || 'gb').toLowerCase();
    const out = [];
    for (const q of qs) {
      const d = await get(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${encodeURIComponent(s.adzunaId)}&app_key=${encodeURIComponent(s.adzunaKey)}&results_per_page=50&max_days_old=7&what=${encodeURIComponent(q)}`);
      for (const j of d.results || []) out.push({ id: `adzuna:${j.id}`, source: 'Adzuna', title: text(j.title), company: j.company?.display_name,
        location: j.location?.display_name, remote: /remote/i.test(j.title + j.description) ? 1 : 0, url: j.redirect_url, description: text(j.description), posted_at: j.created,
        job_type: [j.contract_time, j.contract_type].filter(Boolean).join(','), salary: salaryText(j.salary_min, j.salary_max, null, 'year') });
    }
    return out;
  },
};

// Optional fields from external data: keep only valid values (in place).
function cleanJob(j) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  j.company_url = /^https?:///i.test(j.company_url || '') ? str(j.company_url, 300) : null;
  j.job_type = /^(fulltime|parttime|contract|internship|temporary)(,(fulltime|parttime|contract|internship|temporary))*$/.test(j.job_type || '') ? j.job_type : null;
  j.salary = str(j.salary, 60) || null;
  j.applicants = Number.isInteger(j.applicants) && j.applicants >= 0 && j.applicants < 1e6 ? j.applicants : null;
  return j;
}

// One failing source never breaks the feed; status says what happened per source.
// skip: source names not to run (the online fetcher has no Python, so no JobSpy).
async function fetchAll(profile, secrets, tick = 0, skip = []) {
  const qs = (profile.roles?.length ? profile.roles : profile.skills.slice(0, 2)).slice(0, 5);
  const names = Object.keys(SOURCES).filter((n) => !skip.includes(n));
  const results = await Promise.allSettled(names.map((n) => SOURCES[n](qs, profile, secrets, tick)));
  const jobs = [], status = {};
  results.forEach((r, i) => {
    if (r.status === 'rejected') status[names[i]] = `error: ${r.reason?.message || r.reason}`;
    else if (r.value === null) status[names[i]] = 'no API key';
    else { status[names[i]] = `${r.value.length} jobs${r.value.note ? ` (${r.value.note})` : ''}`; jobs.push(...r.value.filter((j) => j.title && /^https?:\/\//.test(j.url || '')).map((j) => ({ ...j, job_type: jobType(j.job_type) }))); }
  });
  return { jobs, status };
}

// Daily exchange rates per USD from Currency-api (public-apis list; free, no key, no rate limit), with its mirror as fallback.
// External data: keep only finite positive numbers under 3-8 letter codes.
const FX_URLS = ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json'];
function parseRates(d) {
  const rates = Object.fromEntries(Object.entries(d?.usd || {}).filter(([k, v]) => /^[a-z]{3,8}$/.test(k) && Number.isFinite(v) && v > 0));
  return rates.usd ? { date: String(d.date || '').slice(0, 10), rates } : null;
}
async function fetchRates() {
  for (const url of FX_URLS) {
    try { const fx = parseRates(await get(url)); if (fx) return fx; } catch { /* try the mirror */ }
  }
  throw new Error('exchange rates unavailable');
}

// Company website from job data → its domain, ignoring job-board and social links.
const BOARD_RE = /(^|\.)(linkedin|indeed|glassdoor|bdjobs|bayt|ziprecruiter|google|facebook)\./i;
function companyDomain(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, '');
    return BOARD_RE.test(`.${host}`) ? null : host;
  } catch { return null; }
}

const LEGAL_SUFFIX = /\b(ltd|limited|plc|inc|llc|pvt|private|co|company|corp|corporation|group|holdings|the)\b/g;
const coreName = (s = '') => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
function sameCompany(a, b) {
  const x = coreName(a), y = coreName(b);
  return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

// Hunter.io domain search, HR department only. Free plan: max 10 results per call.
async function hunterContacts(company, companyUrl, key) {
  const domain = companyDomain(companyUrl);
  const who = domain ? `domain=${encodeURIComponent(domain)}` : `company=${encodeURIComponent(company)}`;
  const d = await get(`https://api.hunter.io/v2/domain-search?${who}&department=hr&type=personal&limit=10`, { 'X-API-KEY': key })
    .catch((e) => { throw new Error(`Hunter.io: ${e.message === 'HTTP 401' ? 'invalid key' : e.message === 'HTTP 429' ? 'monthly limit reached' : e.message}`); });
  // A name search is fuzzy; keep results only if Hunter matched this company, not a namesake.
  if (!domain && !sameCompany(company, d.data?.organization)) {
    throw new Error(`Hunter.io matched "${d.data?.organization || 'no company'}", not ${company}; nothing saved.`);
  }
  return (d.data?.emails || []).map((e) => ({
    name: [e.first_name, e.last_name].filter(Boolean).join(' ') || e.value.split('@')[0],
    title: e.position || 'HR', email: e.value, profile_url: e.linkedin || null,
  }));
}

module.exports = { SOURCES, fetchAll, cleanJob, fetchRates, parseRates, searchTargets, jobType, salaryText, companyDomain, sameCompany, hunterContacts };
