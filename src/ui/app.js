const $ = (s) => document.querySelector(s);
// `api` is the global from preload.js (contextBridge); redeclaring it is a SyntaxError.

// Tiny DOM builder; text always goes through textContent (job data is untrusted).
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4000);
}

const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, '')); } };
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'))) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const scoreClass = (s) => (s >= 75 ? 'hi' : s >= 50 ? 'mid' : 'lo');

// ---- tabs
function show(tab) {
  document.querySelectorAll('nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== tab));
  ({ feed: loadJobs, alerts: loadAlerts, recruiters: loadRecruiters, profile: loadProfile })[tab]?.();
  // A hidden webview drops its src, so load the default portal on first show.
  if (tab === 'browser' && wv.getAttribute('src') === 'about:blank') wv.src = 'https://www.linkedin.com/jobs/';
}
document.querySelectorAll('nav [data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

// ---- portals browser
const wv = $('#portal');
function browse(url) {
  show('browser');
  wv.src = url;
}
$('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') browse(/^https?:\/\//.test(e.target.value) ? e.target.value : `https://${e.target.value}`); });
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => browse(b.dataset.go)));
$('#back').onclick = () => wv.canGoBack() && wv.goBack();
$('#fwd').onclick = () => wv.canGoForward() && wv.goForward();
$('#reload').onclick = () => wv.reload();
$('#extern').onclick = () => api.openExternal(wv.getURL());

let hiringScript;
async function captureHiringTeam() {
  const url = wv.getURL();
  if (!/linkedin\.com\/jobs\/(view|search|collections)/.test(url)) return;
  hiringScript ??= await api.hiringTeamScript();
  // LinkedIn renders lazily; look twice.
  for (const wait of [2500, 4000]) {
    await new Promise((r) => setTimeout(r, wait));
    if (wv.getURL() !== url) return;
    const people = await wv.executeJavaScript(hiringScript).catch(() => []);
    if (people.length) {
      const added = await api.addRecruiters(people);
      if (added) toast(`Saved ${added} recruiter${added > 1 ? 's' : ''} from this job's hiring team`);
      return;
    }
  }
}
wv.addEventListener('did-navigate', (e) => { $('#url').value = e.url; captureHiringTeam(); });
wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { $('#url').value = e.url; captureHiringTeam(); } });
api.on('open-url', browse);

// ---- feed
let jobs = [];
async function loadJobs() {
  jobs = await api.listJobs({ minScore: +$('#minScore').value || 0, showIneligible: $('#showIneligible').checked });
  renderJobs();
}

function jobCard(j) {
  const r = j.reasons;
  return h('li', { class: `card ${j.eligible ? '' : 'blocked'}` },
    h('div', { class: `score ${scoreClass(j.score)}`, title: 'Match score' }, j.score),
    h('div', { class: 'body' },
      h('a', { href: '#', class: 'title', onclick: (e) => { e.preventDefault(); browse(j.url); } }, j.title),
      h('div', { class: 'muted' }, [j.company, j.location || (j.remote ? 'Remote' : ''), j.also?.length ? `${j.source} (also ${j.also.join(', ')})` : j.source, ago(j.found_at)].filter(Boolean).join(' · ')),
      h('div', { class: 'chips' },
        r.blockers.map((b) => h('span', { class: 'chip bad' }, b)),
        r.notes.map((n) => h('span', { class: 'chip warn' }, n)),
        r.matched.slice(0, 8).map((s) => h('span', { class: 'chip ok' }, s)),
        r.missing.map((s) => h('span', { class: 'chip' }, `missing: ${s}`)))),
    h('div', { class: 'actions' },
      h('button', { onclick: () => browse(j.url) }, 'Open'),
      j.company && h('button', { onclick: () => browse(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`recruiter ${j.company}`)}`) }, 'Recruiters'),
      h('button', { class: j.status === 'saved' ? 'on' : '', onclick: guard(async () => { await api.setJobStatus(j.id, j.status === 'saved' ? 'new' : 'saved'); loadJobs(); }) }, j.status === 'saved' ? 'Saved' : 'Save'),
      h('button', { class: j.status === 'applied' ? 'on' : '', onclick: guard(async () => { await api.setJobStatus(j.id, 'applied'); loadJobs(); }) }, j.status === 'applied' ? 'Applied' : 'Mark applied'),
      h('button', { onclick: guard(async () => { await api.setJobStatus(j.id, 'hidden'); loadJobs(); }) }, 'Hide')));
}

function renderJobs() {
  const q = $('#q').value.toLowerCase();
  const list = q ? jobs.filter((j) => `${j.title} ${j.company} ${j.location} ${j.reasons.matched.join(' ')}`.toLowerCase().includes(q)) : jobs;
  $('#feedCount').textContent = list.length;
  $('#jobs').replaceChildren(...(list.length ? list.map(jobCard) : [h('li', { class: 'empty' }, 'No matching jobs yet. Upload your CV in Profile, then Refresh.')]));
}
$('#q').addEventListener('input', renderJobs);
$('#minScore').addEventListener('change', loadJobs);
$('#showIneligible').addEventListener('change', loadJobs);
$('#refresh').onclick = guard(async () => {
  $('#refresh').disabled = true;
  try {
    const r = await api.refresh();
    if (r?.error) toast(r.error);
  } finally { $('#refresh').disabled = false; }
});

// ---- alerts
async function updateBadge() {
  const n = await api.unreadAlerts();
  $('#alertCount').textContent = n;
  $('#alertCount').hidden = !n;
}
async function loadAlerts() {
  const list = await api.listAlerts();
  $('#alertList').replaceChildren(...(list.length ? list.map((a) => h('li', { class: `card ${a.read ? '' : 'unread'}` },
    h('div', { class: `score ${scoreClass(a.score)}` }, a.score),
    h('div', { class: 'body' },
      h('a', { href: '#', class: 'title', onclick: (e) => { e.preventDefault(); browse(a.url); } }, a.title),
      h('div', { class: 'muted' }, [a.company, a.location, a.source, ago(a.created_at)].filter(Boolean).join(' · ')))))
    : [h('li', { class: 'empty' }, 'No alerts yet. New eligible jobs above your alert score land here.')]));
  updateBadge();
}
$('#readAll').onclick = guard(async () => { await api.readAlerts(); loadAlerts(); });

// ---- recruiters
const STATUSES = ['new', 'requested', 'connected', 'ignored'];
async function loadRecruiters() {
  const { people, companies } = await api.listRecruiters();
  $('#people').replaceChildren(...(people.length ? people.map((p) => h('li', { class: 'card' },
    h('div', { class: 'body' },
      h('div', { class: 'title' }, p.name),
      h('div', { class: 'muted' }, [p.title, p.company, p.email].filter(Boolean).join(' · ')),
      h('div', { class: 'muted small' }, `via ${p.source}${p.job_title ? ` · ${p.job_title}` : ''}`)),
    h('div', { class: 'actions' },
      p.profile_url && h('button', { class: 'primary', onclick: () => browse(p.profile_url) }, 'Connect'),
      p.email && h('button', { onclick: () => api.openExternal(`mailto:${p.email}`) }, 'Email'),
      (() => {
        const sel = h('select', { 'aria-label': 'Status', onchange: guard(async (e) => { await api.setRecruiterStatus(p.id, e.target.value); loadRecruiters(); }) },
          STATUSES.map((s) => h('option', { value: s }, s)));
        sel.value = p.status;
        return sel;
      })())))
    : [h('li', { class: 'empty' }, 'No recruiters yet. Open LinkedIn jobs from the feed: the hiring team is saved automatically.')]));
  $('#companies').replaceChildren(...companies.map((c) => h('li', { class: 'card' },
    h('div', { class: 'body' }, h('div', { class: 'title' }, c.company), h('div', { class: 'muted' }, `${c.jobs} job${c.jobs > 1 ? 's' : ''} · best match ${c.best}`)),
    h('div', { class: 'actions' },
      h('button', { onclick: guard(async (e) => {
        e.target.disabled = true;
        try {
          const n = await api.findCompanyContacts(c.company);
          toast(n ? `Added ${n} HR contact${n > 1 ? 's' : ''} at ${c.company}` : `No new HR contacts found at ${c.company}`);
          if (n) loadRecruiters();
        } finally { e.target.disabled = false; }
      }) }, 'Find HR contacts'),
      h('button', { onclick: () => browse(c.search) }, 'Find recruiters')))));
}

// ---- profile
async function loadProfile() {
  const { profile: p, keys } = await api.getProfile();
  const f = $('#profileForm').elements;
  f.skills.value = p.skills.join(', ');
  f.roles.value = p.roles.join(', ');
  f.locations.value = p.locations.join('; ');
  f.relocate.value = p.relocate.join('; ');
  f.remoteFrom.value = p.remoteFrom.join('; ');
  f.distanceKm.value = p.distanceKm;
  f.years.value = p.years;
  f.minScore.value = p.minScore;
  f.adzunaCountry.value = p.adzunaCountry;
  f.needsSponsorship.checked = p.needsSponsorship;
  $('#cvFile').textContent = p.cvFile ? `Current CV: ${p.cvFile}` : 'No CV uploaded yet';
  document.querySelectorAll('[data-key]').forEach((s) => (s.textContent = keys[s.dataset.key] ? '✓ saved' : ''));
  return p;
}
const split = (s, sep = ',') => s.split(sep).map((x) => x.trim()).filter(Boolean);
$('#upload').onclick = guard(async () => {
  const p = await api.uploadCv();
  if (!p) return;
  await loadProfile();
  toast(`CV read: ${p.skills.length} skills, ${p.years} yrs. Check the fields, then Save. Fetching jobs…`);
  api.refresh();
});
$('#profileForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  await api.saveProfile({ skills: split(f.skills.value), roles: split(f.roles.value), locations: split(f.locations.value, ';'),
    relocate: split(f.relocate.value, ';'), remoteFrom: split(f.remoteFrom.value, ';'), distanceKm: f.distanceKm.value,
    years: f.years.value, minScore: f.minScore.value, adzunaCountry: f.adzunaCountry.value, needsSponsorship: f.needsSponsorship.checked });
  $('#minScore').value = f.minScore.value;
  toast('Profile saved, jobs re-scored');
}));
$('#keysForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  await api.saveKeys({ jsearchKey: f.jsearchKey.value, adzunaId: f.adzunaId.value, adzunaKey: f.adzunaKey.value, hunterKey: f.hunterKey.value });
  e.target.reset();
  await loadProfile();
  toast('Keys saved. Refreshing…');
  api.refresh();
}));

// ---- live updates
api.on('updated', (r) => {
  const errs = Object.entries(r.status).filter(([, v]) => v.startsWith('error')).map(([k]) => k);
  $('#status').textContent = `Updated ${new Date(r.at).toLocaleTimeString()} · ${r.fetched} scanned${errs.length ? ` · failed: ${errs.join(', ')}` : ''}`;
  $('#status').title = Object.entries(r.status).map(([k, v]) => `${k}: ${v}`).join('\n');
  if (r.fresh) toast(`${r.fresh} new matching job${r.fresh > 1 ? 's' : ''}`);
  if (!$('#feed').hidden) loadJobs();
  updateBadge();
});
api.on('goto', show);

(async () => {
  const p = await loadProfile();
  $('#minScore').value = p.minScore;
  if (!p.skills.length) show('profile'); else loadJobs();
  updateBadge();
})();
