// Online job fetcher: a Supabase Edge Function (Deno), called hourly by pg_cron. Bundled with sources.js and match.js
// by scripts/build-web.mjs into supabase/functions/fetch-jobs/index.ts.
// Per run: the next few users' searches (round robin) → shared pool; then exchange rates and the scoring corpus.
// Scoring happens in each user's browser, against their own profile.
const { fetchAll, cleanJob, fetchRates } = __req('./sources');
const { buildCorpus, corpusToJson, parseTime } = __req('./match');

const env = (k) => Deno.env.get(k) || '';
const BASE = `${env('SUPABASE_URL')}/rest/v1`;
const HEAD = { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' };
// ponytail: 3 users per hourly run = each user's searches every 5 h at 15 users; raise when the API quotas allow.
const USERS_PER_RUN = 3, MIN_GAP_MS = 50 * 60 * 1000;

async function rest(path, init = {}) {
  const res = await fetch(`${BASE}/${path}`, { ...init, headers: { ...HEAD, ...init.headers } });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}
const getMeta = async (key) => (await rest(`meta?key=eq.${key}&select=value`))[0]?.value || null;
const setMeta = (key, value) => rest('meta', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });

async function run() {
  const state = (await getMeta('fetch_state')) || { tick: Math.floor(Date.now() / 36e5), cursor: 0, at: null };
  // Anyone holding the public key can call this URL; the gap stops it being used to burn API quota.
  if (state.at && Date.now() - Date.parse(state.at) < MIN_GAP_MS) return { skipped: 'ran less than 50 min ago' };
  await setMeta('fetch_state', { ...state, at: new Date().toISOString() });

  const profiles = (await rest('profiles?select=data&order=user_id')).map((r) => r.data).filter((p) => p?.skills?.length);
  const batch = profiles.length ? Array.from({ length: Math.min(USERS_PER_RUN, profiles.length) }, (_, i) => profiles[(state.cursor + i) % profiles.length]) : [];
  const secrets = { jsearchKey: env('JSEARCH_KEY'), reedKey: env('REED_KEY'), adzunaId: env('ADZUNA_ID'), adzunaKey: env('ADZUNA_KEY') };
  const status = {}, jobs = new Map();
  for (const p of batch) {
    const r = await fetchAll(p, secrets, state.tick, ['jobspy']);
    for (const [k, v] of Object.entries(r.status)) status[k] = status[k]?.startsWith('error') ? status[k] : v;
    for (const j of r.jobs) jobs.set(j.id, j);
  }
  const rows = [...jobs.values()].map((j) => {
    cleanJob(j);
    const t = parseTime(j.posted_at);
    return { id: String(j.id).slice(0, 200), source: String(j.source || '').slice(0, 60), title: String(j.title).slice(0, 300), company: String(j.company || '').slice(0, 200),
      location: String(j.location || '').slice(0, 200), remote: !!j.remote, url: String(j.url).slice(0, 2000), description: String(j.description || '').slice(0, 30000),
      posted_at: String(j.posted_at || '').slice(0, 40), posted: Number.isFinite(t) && t <= Date.now() + 864e5 ? new Date(t).toISOString() : null,
      company_url: j.company_url, job_type: j.job_type, salary: j.salary, applicants: j.applicants,
      emails: (Array.isArray(j.emails) ? j.emails : []).filter((e) => typeof e === 'string' && e.length < 200).slice(0, 10) };
  });
  for (let i = 0; i < rows.length; i += 500) await rest('rpc/upsert_pool', { method: 'POST', body: JSON.stringify({ jobs: rows.slice(i, i + 500) }) });
  await rest('rpc/prune_pool', { method: 'POST', body: '{}' });

  // Exchange rates once a day; stale rates beat none.
  const fx = await getMeta('fx');
  const today = new Date().toISOString().slice(0, 10);
  if (fx?.fetched !== today) await fetchRates().then((r) => setMeta('fx', { ...r, fetched: today })).catch(() => {});

  // Corpus over the whole pool (document frequencies, market pay medians) for the browsers' scoring.
  const pool = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest('jobs_pool?select=title,description,location,company,salary&order=id', { headers: { Range: `${from}-${from + 999}` } });
    pool.push(...page);
    if (page.length < 1000) break;
  }
  await setMeta('corpus', corpusToJson(buildCorpus(pool)));

  const result = { at: new Date().toISOString(), fetched: rows.length, fresh: 0, status, users: batch.length, pool: pool.length };
  await setMeta('last_fetch', result);
  await setMeta('fetch_state', { tick: state.tick + 1, cursor: profiles.length ? (state.cursor + batch.length) % profiles.length : 0, at: result.at });
  return result;
}

Deno.serve(async () => {
  try { return Response.json(await run()); } catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
});
