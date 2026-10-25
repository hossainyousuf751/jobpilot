// Job sources. Each returns normalized jobs:
// { id, source, title, company, location, remote, url, description, posted_at }

const text = (html = '') => html.replace(/<(br|\/p|\/li|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// In Electron use Chromium's stack: honours system proxy and corporate root certs.
const doFetch = process.versions.electron ? require('electron').net.fetch : fetch;

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

  async remotive(qs) {
    const out = [];
    for (const q of qs) {
      const d = await get(`https://remotive.com/api/remote-jobs?limit=50&search=${encodeURIComponent(q)}`);
      for (const j of d.jobs) out.push({ id: `remotive:${j.id}`, source: 'Remotive', title: j.title, company: j.company_name,
        location: j.candidate_required_location, remote: 1, url: j.url, description: text(j.description), posted_at: j.publication_date });
    }
    return out;
  },

  // No search param; returns the newest postings, the scorer filters them.
  async arbeitnow() {
    const d = await get('https://www.arbeitnow.com/api/job-board-api');
    return d.data.map((j) => ({ id: `arbeitnow:${j.slug}`, source: 'Arbeitnow', title: j.title, company: j.company_name,
      location: j.location, remote: j.remote ? 1 : 0, url: j.url, description: text(j.description), posted_at: new Date(j.created_at * 1000).toISOString() }));
  },

  async remoteok() {
    const d = await get('https://remoteok.com/api');
    return d.filter((j) => j.id && j.position).map((j) => ({ id: `remoteok:${j.id}`, source: 'RemoteOK', title: j.position, company: j.company,
      location: j.location, remote: 1, url: j.url, description: text(j.description), posted_at: j.date }));
  },

  // LinkedIn / Indeed / Glassdoor / ZipRecruiter listings via RapidAPI JSearch.
  async jsearch(qs, p, s) {
    if (!s.jsearchKey) return null;
    const where = p.locations?.[0] ? ` in ${p.locations[0]}` : '';
    const out = [];
    for (const q of qs) {
      const d = await get(`https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q + where)}&page=1&num_pages=1&date_posted=week`,
        { 'X-RapidAPI-Key': s.jsearchKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' });
      for (const j of d.data || []) out.push({ id: `jsearch:${j.job_id}`, source: j.job_publisher || 'JSearch', title: j.job_title,
        company: j.employer_name, location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || (j.job_is_remote ? 'Remote' : ''),
        remote: j.job_is_remote ? 1 : 0, url: j.job_apply_link, description: j.job_description, posted_at: j.job_posted_at_datetime_utc });
    }
    return out;
  },

  async adzuna(qs, p, s) {
    if (!s.adzunaId || !s.adzunaKey) return null;
    const country = (p.adzunaCountry || 'gb').toLowerCase();
    const out = [];
    for (const q of qs) {
      const d = await get(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${encodeURIComponent(s.adzunaId)}&app_key=${encodeURIComponent(s.adzunaKey)}&results_per_page=50&max_days_old=7&what=${encodeURIComponent(q)}`);
      for (const j of d.results || []) out.push({ id: `adzuna:${j.id}`, source: 'Adzuna', title: text(j.title), company: j.company?.display_name,
        location: j.location?.display_name, remote: /remote/i.test(j.title + j.description) ? 1 : 0, url: j.redirect_url, description: text(j.description), posted_at: j.created });
    }
    return out;
  },
};

// One failing source never breaks the feed; status says what happened per source.
async function fetchAll(profile, secrets, tick = 0) {
  const qs = (profile.roles?.length ? profile.roles : profile.skills.slice(0, 2)).slice(0, 3);
  const names = Object.keys(SOURCES);
  const results = await Promise.allSettled(names.map((n) => SOURCES[n](qs, profile, secrets, tick)));
  const jobs = [], status = {};
  results.forEach((r, i) => {
    if (r.status === 'rejected') status[names[i]] = `error: ${r.reason?.message || r.reason}`;
    else if (r.value === null) status[names[i]] = 'no API key';
    else { status[names[i]] = `${r.value.length} jobs${r.value.note ? ` (${r.value.note})` : ''}`; jobs.push(...r.value.filter((j) => j.title && /^https?:\/\//.test(j.url || ''))); }
  });
  return { jobs, status };
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

module.exports = { fetchAll, searchTargets, companyDomain, sameCompany, hunterContacts };
