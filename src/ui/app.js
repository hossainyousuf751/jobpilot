const $ = (s) => document.querySelector(s);
// `api` is the global from preload.js (contextBridge); redeclaring it is a SyntaxError.

// Tiny DOM builder; text always goes through textContent (job data is untrusted).
// Props: on* → listener, vars → CSS custom properties, everything else → attribute.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'vars') for (const [n, x] of Object.entries(v)) el.style.setProperty(`--${n}`, x);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `i ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
const btn = (label, iconName, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, iconName && icon(iconName), h('span', {}, label));
const iconBtn = (iconName, label, onclick, cls = '') => h('button', { class: `icon-btn ${cls}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(iconName));

// ---- toasts
function toast(msg, type = 'info') {
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 180); };
  const t = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info'), h('p', {}, msg), iconBtn('x', 'Dismiss', close));
  $('#toasts').append(t);
  setTimeout(close, type === 'error' ? 7000 : 4000);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, ''), 'error'); } };

// ---- formatting
// Sources send "2026-10-24", ISO with or without zone, or SQLite "2026-10-24 06:00:00" (UTC).
function ago(iso) {
  if (!iso) return '';
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : /Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
  const m = Math.round((Date.now() - new Date(s)) / 60000);
  if (Number.isNaN(m)) return '';
  return m < 60 ? `${Math.max(m, 0)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}
const tone = (s) => (s >= 75 ? 'hi' : s >= 50 ? 'mid' : 'lo');
const ring = (score, eligible = true, cls = '') => h('div', { class: `ring ${eligible ? tone(score) : 'na'} ${cls}`, vars: { p: score },
  role: 'img', 'aria-label': `Match score ${score} of 100${eligible ? '' : ', not eligible'}` }, score);
const AVATAR = ['#0f6cbd', '#0e7a3e', '#b4570a', '#7a49b8', '#c4314b', '#077c7c', '#4f6bed', '#5c6b7a'];
function avatar(name = '?', size = '') {
  const words = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
  let hash = 0;
  for (const c of String(name)) hash = (hash * 31 + c.codePointAt(0)) | 0;
  return h('div', { class: `avatar ${size}`, vars: { 'avatar-bg': AVATAR[Math.abs(hash) % AVATAR.length] }, 'aria-hidden': 'true' }, initials);
}
const emptyState = (iconName, title, text, action) => h('div', { class: 'empty' }, icon(iconName), h('strong', {}, title), text && h('span', {}, text), action);
const TYPE_LABEL = { fulltime: 'Full-time', parttime: 'Part-time', contract: 'Contract', internship: 'Internship', temporary: 'Temporary' };
const types = (j) => (j.job_type || '').split(',').filter(Boolean).map((t) => TYPE_LABEL[t] || t);
const posted = (j) => (ago(j.posted_at) ? `Posted ${ago(j.posted_at)}` : `Found ${ago(j.found_at)}`);

// ---- score breakdown: the nine metrics, their current weights, and what had no evidence (and why)
const METRIC_INFO = {
  skills: ['Skills', 'Share of the job’s skills you have; “nice to have” skills count half'],
  title: ['Role fit', 'Job title against your target roles'],
  experience: ['Experience', 'Years the job asks for against yours, graded'],
  cv: ['CV similarity', 'Wording of your experience against the posting (TF-IDF)'],
  edge: ['Skill edge', 'Rarity-weighted skill match: rare skills you have count more'],
  seniority: ['Seniority', 'Title level against the level your years suggest'],
  education: ['Education', 'Degree asked for against yours'],
  pay: ['Pay', 'Listed salary against your expected salary'],
  freshness: ['Freshness', 'How recently it was posted; early applicants get read'],
};
const WHY_MISSING = { experience: 'no years stated', cv: 'appears after the next refresh', edge: 'no skills found', education: 'no degree stated, or yours not set',
  pay: 'no salary listed in your currency, or no expected salary in Profile', freshness: 'no posting date' };
let scoreWeights = null; // current weights (learned or default), from stats
// Notes that are good news render green; the rest (stretch role, below market…) amber.
const GOOD_NOTE = /above market|rare skill|apply early|strong cv fit|few applicants|no applicants yet/i;
const noteClass = (n) => (GOOD_NOTE.test(n) ? 'ok' : 'warn');
function scoreBars(parts = {}) {
  const w = scoreWeights || {};
  const rows = Object.entries(METRIC_INFO).filter(([k]) => parts[k] != null).map(([k, [label, tip]]) =>
    tipOn(h('div', { class: 'bar-row' }, h('span', {}, label), h('div', { class: 'bar' }, h('span', { vars: { p: parts[k] } })), h('b', {}, `${parts[k]}%`),
      h('i', { class: 'bar-w' }, w[k] != null ? `×${Math.round(w[k])}` : '')), `${tip}. Weight ${w[k] != null ? Math.round(w[k]) : '?'} of 100.`));
  const missing = Object.keys(METRIC_INFO).filter((k) => parts[k] == null && WHY_MISSING[k]);
  return h('div', { class: 'bars' }, rows,
    missing.length ? h('p', { class: 'help not-scored' }, `Not scored: ${missing.map((k) => `${METRIC_INFO[k][0].toLowerCase()} (${WHY_MISSING[k]})`).join(', ')}.`) : null);
}

// ---- navigation
// "Matches" and "All jobs" are one section with a different scope.
let scope = 'matches';
let currentTab = 'today';
function show(tab) {
  const section = tab === 'all' ? 'feed' : tab;
  if (section === 'feed') scope = tab === 'all' ? 'all' : 'matches';
  if (currentTab === 'today' && tab !== 'today') leaveToday();
  currentTab = tab;
  const swap = () => {
    document.querySelectorAll('nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== section));
  };
  // Cross-fade between pages where the platform supports it (Chromium does).
  // Skipped while the window is hidden (the transition would abort); an aborted transition still runs swap().
  if (document.startViewTransition && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t = document.startViewTransition(swap);
    [t.ready, t.finished, t.updateCallbackDone].forEach((p) => p.catch(() => {}));
  } else swap();
  ({ today: loadToday, review: loadReview, insights: loadInsights, cvbuilder: loadCvBuilder, letters: loadLetters, feed: loadJobs, myjobs: loadMyJobs, alerts: loadAlerts,
    recruiters: loadRecruiters, profile: loadProfile })[section]?.();
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
      if (added) toast(`Saved ${added} recruiter${added > 1 ? 's' : ''} from this job's hiring team`, 'success');
      return;
    }
  }
}
wv.addEventListener('did-navigate', (e) => { $('#url').value = e.url; captureHiringTeam(); });
wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { $('#url').value = e.url; captureHiringTeam(); } });
api.on('open-url', browse);

// ---- overview tiles + sidebar counts
async function loadStats() {
  const s = await api.stats();
  scoreWeights = s.calibration.weights;
  $('#matchCount').textContent = s.matches || '';
  $('#allCount').textContent = s.total || '';
  const pipeline = s.saved + s.applied + s.interview + s.offer;
  $('#myCount').textContent = pipeline || '';
  $('#reviewCount').textContent = s.toReview || '';
  const tile = (label, iconName, value, note, cls = '') => h('div', { class: `kpi ${cls}` },
    h('div', { class: 'kpi-label' }, icon(iconName), label), h('div', { class: 'kpi-value' }, value, note && h('small', {}, note)));
  $('#kpis').replaceChildren(
    tile('Matches', 'target', s.matches, `of ${s.total} jobs`, 'accent'),
    tile('New in 24 h', 'clock', s.newToday, 'matches'),
    tile('Strong CV fit', 'check', s.strong, s.matches ? `${Math.round((100 * s.strong) / s.matches)}% of matches` : ''),
    tile('Pipeline', 'briefcase', pipeline, s.interview ? `${s.interview} interviewing` : `${s.applied} applied`));
  if (s.last) renderSync(s.last);
}

// ---- feed: list + details
let jobs = [], selectedId = null, firstLoad = true;
const FILTERS = { q: '', where: '', days: '0', workplace: '', jobType: '', sort: 'match' };
const filtersActive = () => Object.entries(FILTERS).some(([k, v]) => $(`#${k}`).value !== v) || $('#salaryOnly').checked;
const wide = () => matchMedia('(min-width: 1181px)').matches;

async function loadJobs() {
  const matches = scope === 'matches';
  $('#feedTitle').textContent = matches ? 'Matches' : 'All jobs';
  $('#feedSub').textContent = matches ? 'Jobs you’re eligible for, ranked by how well they fit your CV.'
    : 'Every job JobPilot has found, including ones you’re not eligible for (they show why).';
  $('#minScoreLabel').hidden = !matches;
  $('#clearFilters').hidden = !filtersActive();
  if (firstLoad) $('#jobs').replaceChildren(...Array.from({ length: 7 }, skeletonRow));
  jobs = await api.listJobs({ scope, minScore: +$('#minScore').value || 0, q: $('#q').value, location: $('#where').value,
    days: $('#days').value, workplace: $('#workplace').value, jobType: $('#jobType').value, salaryOnly: $('#salaryOnly').checked, sort: $('#sort').value });
  firstLoad = false;
  $('#resultCount').textContent = `${jobs.length}${jobs.length >= 500 ? '+' : ''} ${jobs.length === 1 ? 'job' : 'jobs'}`;
  $('#jobs').replaceChildren(...(jobs.length ? jobs.map(jobRow) : [h('li', {}, filtersActive()
    ? emptyState('filter', 'No jobs match these filters', 'Try a wider date range or clear the filters.', btn('Clear filters', 'x', clearFilters))
    : emptyState('inbox', matches ? 'No matches yet' : 'No jobs yet', matches ? 'Check All jobs, or update your profile and refresh.' : 'Press Refresh to fetch jobs.'))]));
  loadStats();
  if (selectedId && jobs.some((j) => j.id === selectedId)) markSelected();
  else if (jobs.length && wide()) select(jobs[0].id, false);
  else renderDetail(null);
}
const skeletonRow = () => h('li', { class: 'skeleton', 'aria-hidden': 'true' },
  h('div', { class: 'sk sq' }), h('div', {}, h('div', { class: 'sk line w60' }), h('div', { class: 'sk line w40' })), h('div', { class: 'sk round' }));

function clearFilters() {
  for (const [k, v] of Object.entries(FILTERS)) $(`#${k}`).value = v;
  $('#salaryOnly').checked = false;
  loadJobs();
}
$('#clearFilters').onclick = clearFilters;

function jobRow(j) {
  const flags = [...j.reasons.blockers.map((b) => h('span', { class: 'chip bad' }, icon('alert'), b)),
    ...j.reasons.notes.filter((n) => n !== 'Strong CV fit').map((n) => h('span', { class: `chip ${noteClass(n)}` }, n))];
  return h('li', { class: `job ${j.eligible ? '' : 'blocked'}`, 'data-id': j.id, tabindex: '0', 'aria-selected': 'false',
    onclick: () => select(j.id), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) select(j.id); } },
  avatar(j.company || j.title),
  h('div', { class: 'grow' },
    h('div', { class: 'job-title' }, j.title),
    h('div', { class: 'job-meta' }, [j.company, j.location || (j.remote ? 'Remote' : ''), ago(j.posted_at) || ago(j.found_at)].filter(Boolean).join(' · ')),
    h('div', { class: 'chips' },
      j.reasons.notes.includes('Strong CV fit') && h('span', { class: 'chip ok' }, icon('check'), 'Strong CV fit'),
      j.salary && h('span', { class: 'chip accent' }, icon('money'), j.salary),
      types(j).map((t) => h('span', { class: 'chip' }, t)),
      j.remote ? h('span', { class: 'chip' }, 'Remote') : null,
      flags.slice(0, 2))),
  h('div', { class: 'job-side' },
    h('div', { class: 'job-actions' },
      iconBtn('bookmark', j.status === 'saved' ? 'Unsave' : 'Save', (e) => { e.stopPropagation(); setStatus(j.id, j.status === 'saved' ? 'new' : 'saved'); }, j.status === 'saved' ? 'on' : ''),
      iconBtn('eye-off', 'Hide', (e) => { e.stopPropagation(); setStatus(j.id, 'hidden'); }, 'danger')),
    ring(j.score, !!j.eligible)));
}

function markSelected() {
  document.querySelectorAll('#jobs .job').forEach((r) => {
    const on = r.dataset.id === selectedId;
    r.classList.toggle('selected', on);
    r.setAttribute('aria-selected', on);
  });
}
async function select(id, focus = true) {
  selectedId = id;
  markSelected();
  const row = document.querySelector(`#jobs .job[data-id="${CSS.escape(id)}"]`);
  if (row && focus) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
  renderDetail(await api.getJob(id));
}

function renderDetail(j) {
  const pane = $('#detail');
  pane.classList.toggle('empty-pane', !j);
  if (!j) return pane.replaceChildren(emptyState('inbox', 'Select a job', 'Its full description, salary and why it matches you appear here.'));
  const r = j.reasons, parts = r.parts || {};
  const applied = j.status === 'applied', saved = j.status === 'saved';
  const fact = (iconName, label, value) => value && h('div', { class: 'fact' }, h('div', { class: 'fact-label' }, icon(iconName), label), h('div', { class: 'fact-value' }, value));
  pane.replaceChildren(
    h('div', { class: 'detail-head' },
      h('div', { class: 'detail-top' }, avatar(j.company || j.title, 'lg'),
        h('div', { class: 'grow' }, h('h2', {}, j.title), h('div', { class: 'detail-company' }, [j.company, j.location].filter(Boolean).join(' · '))),
        iconBtn('x', 'Close details', () => { selectedId = null; markSelected(); renderDetail(null); })),
      h('div', { class: 'detail-actions' },
        btn('Open posting', 'globe', () => browse(j.url), 'btn btn-primary'),
        btn('Browser', 'external', () => api.openExternal(j.url)),
        btn(saved ? 'Saved' : 'Save', 'bookmark', () => setStatus(j.id, saved ? 'new' : 'saved'), `btn ${saved ? 'on' : ''}`),
        btn(applied ? `Applied${j.stage && j.stage !== 'applied' ? ` · ${j.stage}` : ''}` : 'Mark applied', 'check', () => setStatus(j.id, applied ? 'saved' : 'applied'), `btn ${applied ? 'on' : ''}`),
        j.company && btn('Recruiters', 'users', () => browse(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`recruiter ${j.company}`)}`)),
        iconBtn('eye-off', 'Hide this job', () => setStatus(j.id, 'hidden'), 'danger'))),
    h('div', { class: 'detail-body' },
      r.blockers.map((b) => h('div', { class: 'callout bad' }, icon('alert'), b)),
      r.notes.filter((n) => n !== 'Strong CV fit').map((n) => h('div', { class: `callout ${noteClass(n)}` }, icon(noteClass(n) === 'ok' ? 'check' : 'info'), n)),
      h('div', { class: 'match-panel' }, ring(j.score, !!j.eligible, 'lg'),
        scoreBars(parts)),
      (r.matched.length || r.missing.length) ? h('div', {}, h('h3', {}, 'Skills'),
        h('div', { class: 'chips' }, r.matched.map((s) => h('span', { class: 'chip ok' }, icon('check'), s)), r.missing.map((s) => h('span', { class: 'chip ghost' }, s)))) : null,
      h('h3', {}, 'Details'),
      h('div', { class: 'facts' },
        fact('money', 'Salary', j.salary || 'Not listed'),
        fact('briefcase', 'Job type', types(j).join(', ') || 'Not listed'),
        fact('pin', 'Workplace', j.remote ? 'Remote' : 'On-site'),
        fact('clock', 'Posted', ago(j.posted_at) || `found ${ago(j.found_at)}`),
        fact('link', 'Source', j.also?.length ? `${j.source}, ${j.also.join(', ')}` : j.source)),
      h('h3', {}, 'About the job'),
      h('div', { class: 'desc' }, j.description || 'The source sent no description. Open the posting to read it.')));
  pane.scrollTop = 0;
}

async function setStatus(id, status) {
  await guard(async () => {
    const i = jobs.findIndex((j) => j.id === id);
    await api.setJobStatus(id, status);
    if (status === 'hidden') {
      const next = jobs[i + 1] || jobs[i - 1];
      selectedId = next?.id || null;
      toast('Job hidden. It won’t appear in your feeds again.');
    } else if (status === 'saved') toast('Saved to My jobs', 'success');
    else if (status === 'applied') toast('Marked as applied. Track it in My jobs.', 'success');
    await loadJobs();
    if (selectedId) select(selectedId, false);
  })();
}

// Keyboard triage, like mail clients: J/K move, S save, H hide, Enter open, / search.
document.addEventListener('keydown', (e) => {
  if ($('#feed').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); return; }
  if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  const i = jobs.findIndex((j) => j.id === selectedId);
  const j = jobs[i];
  const go = (k) => { const n = jobs[Math.max(0, Math.min(jobs.length - 1, k))]; if (n) { e.preventDefault(); select(n.id); } };
  if (e.key === 'j' || e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'k' || e.key === 'ArrowUp') go(i - 1);
  else if (j && e.key === 's') setStatus(j.id, j.status === 'saved' ? 'new' : 'saved');
  else if (j && e.key === 'h') setStatus(j.id, 'hidden');
  else if (j && e.key === 'Enter' && document.activeElement?.dataset?.id === j.id) browse(j.url);
  else if (e.key === 'Escape' && !wide()) { selectedId = null; markSelected(); renderDetail(null); }
});

let searchTimer;
const reloadSoon = () => { clearTimeout(searchTimer); searchTimer = setTimeout(guard(loadJobs), 250); };
['#q', '#where'].forEach((s) => $(s).addEventListener('input', reloadSoon));
['#days', '#workplace', '#jobType', '#salaryOnly', '#sort', '#minScore'].forEach((s) => $(s).addEventListener('change', guard(loadJobs)));
$('#refresh').onclick = guard(async () => {
  const r = await api.refresh();
  if (r?.error) toast(r.error, 'error');
});

// Open a job from another page (alerts, board) in the All jobs view.
async function openJob(id) {
  show('all');
  await select(id);
}

// ---- my jobs: pipeline board with drag and drop (and a select per card for keyboard users)
const STAGES = [['saved', 'Saved', 'var(--accent)'], ['applied', 'Applied', 'var(--text-3)'], ['interview', 'Interview', 'var(--warning)'],
  ['offer', 'Offer', 'var(--success)'], ['rejected', 'Rejected', 'var(--danger)']];
const stageOf = (j) => (j.status === 'saved' ? 'saved' : j.stage || 'applied');
async function moveTo(id, stage) {
  if (stage === 'saved') await api.setJobStatus(id, 'saved');
  else await api.setJobStage(id, stage);
  loadMyJobs();
  loadStats();
}
async function loadMyJobs() {
  const list = await api.myJobs();
  $('#board').replaceChildren(...STAGES.map(([stage, label, color]) => {
    const items = list.filter((j) => stageOf(j) === stage);
    const col = h('div', { class: 'column', 'data-stage': stage,
      ondragover: (e) => { e.preventDefault(); col.classList.add('drop'); },
      ondragleave: () => col.classList.remove('drop'),
      ondrop: guard(async (e) => { e.preventDefault(); col.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id) await moveTo(id, stage); }) },
    h('div', { class: 'column-head' }, h('span', { class: 'dot', vars: { 'dot-c': color } }), label, h('span', { class: 'count' }, items.length)),
    h('ul', { class: 'column-body' }, items.length ? items.map(ticket) : h('li', { class: 'column-empty' }, stage === 'saved' ? 'Save jobs from your feed' : 'Drag cards here')));
    return col;
  }));
}
function ticket(j) {
  const sel = h('select', { 'aria-label': `Move ${j.title} to stage`, onclick: (e) => e.stopPropagation(), onchange: guard((e) => moveTo(j.id, e.target.value)) },
    STAGES.map(([v, label]) => h('option', { value: v }, label)));
  sel.value = stageOf(j);
  return h('li', { class: 'ticket', draggable: 'true',
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', j.id); e.currentTarget.classList.add('dragging'); },
    ondragend: (e) => e.currentTarget.classList.remove('dragging') },
  h('div', { class: 'ticket-top' }, avatar(j.company || j.title, 'sm'),
    h('div', { class: 'grow' }, h('a', { href: '#', class: 'ticket-title', onclick: (e) => { e.preventDefault(); openJob(j.id); } }, j.title), h('div', { class: 'ticket-co' }, j.company || ''))),
  (() => {
    // Time in the current stage; applied 7+ days with no movement → nudge to follow up.
    const since = ago(j.stage_at || j.found_at);
    const days = parseInt(since, 10);
    const due = stageOf(j) === 'applied' && /d ago$/.test(since) && days >= 7;
    return since && h('div', { class: 'ticket-age' }, due ? h('span', { class: 'chip warn' }, icon('flag'), `Follow up · ${days}d`) : h('span', { class: 'help' }, `${STAGES.find(([v]) => v === stageOf(j))[1]} ${since}`));
  })(),
  h('div', { class: 'ticket-foot' }, j.salary && h('span', { class: 'chip accent' }, j.salary), sel,
    iconBtn('x', `Remove ${j.title} from My jobs`, guard(async () => { await api.setJobStatus(j.id, 'new'); loadMyJobs(); loadStats(); }))));
}

// ---- alerts
async function updateBadge() {
  const n = await api.unreadAlerts();
  $('#alertCount').textContent = n;
  $('#alertCount').hidden = !n;
}
async function loadAlerts() {
  const list = await api.listAlerts();
  const recent = (a) => (Date.now() - new Date(`${a.created_at.replace(' ', 'T')}Z`)) < 864e5;
  const row = (a) => h('li', { class: 'row', tabindex: '0', onclick: () => openJob(a.job_id), onkeydown: (e) => e.key === 'Enter' && openJob(a.job_id) },
    h('span', { class: a.read ? 'read-dot' : 'unread-dot', 'aria-label': a.read ? null : 'Unread' }), avatar(a.company || a.title, 'sm'),
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, a.title), h('div', { class: 'muted' }, [a.company, a.location, a.source, ago(a.created_at)].filter(Boolean).join(' · '))),
    ring(a.score));
  const today = list.filter(recent), earlier = list.filter((a) => !recent(a));
  // replaceChildren needs a flat list of nodes: build each group as [heading, ...rows] or nothing.
  const group = (label, items) => (items.length ? [h('li', { class: 'row-group' }, label), ...items.map(row)] : []);
  $('#alertList').replaceChildren(...(list.length ? [...group('Last 24 hours', today), ...group('Earlier', earlier)]
    : [h('li', {}, emptyState('bell', 'No alerts yet', 'New eligible jobs above your alert score land here, with a Windows notification.'))]));
  updateBadge();
}
$('#readAll').onclick = guard(async () => { await api.readAlerts(); loadAlerts(); toast('All alerts marked as read', 'success'); });

// ---- recruiters
const STATUSES = [['new', 'New'], ['requested', 'Requested'], ['connected', 'Connected'], ['ignored', 'Ignored']];
async function loadRecruiters() {
  const { people, companies } = await api.listRecruiters();
  $('#people').replaceChildren(...(people.length ? people.map((p) => {
    const sel = h('select', { 'aria-label': `Status for ${p.name}`, onchange: guard(async (e) => { await api.setRecruiterStatus(p.id, e.target.value); loadRecruiters(); }) },
      STATUSES.map(([v, label]) => h('option', { value: v }, label)));
    sel.value = p.status;
    return h('tr', {},
      h('td', {}, h('div', { class: 'person' }, avatar(p.name, 'sm'), h('div', {}, h('div', { class: 'strong' }, p.name), h('div', { class: 'help' }, p.title || p.email || '')))),
      h('td', {}, p.company || '—'),
      h('td', { class: 'muted' }, p.source, p.job_title ? h('div', { class: 'help' }, p.job_title) : null),
      h('td', {}, sel),
      h('td', { class: 'right' },
        p.profile_url && iconBtn('link', `Open ${p.name} on LinkedIn`, () => browse(p.profile_url)),
        p.email && iconBtn('mail', `Email ${p.name}`, () => api.openExternal(`mailto:${p.email}`))));
  }) : [h('tr', {}, h('td', { colspan: '5' }, emptyState('users', 'No recruiters yet', 'Open LinkedIn jobs in Portals (the hiring team is saved automatically), or use Find HR contacts below.')))]));
  $('#companies').replaceChildren(...(companies.length ? companies.map((c) => h('li', { class: 'company' },
    h('div', { class: 'company-top' }, avatar(c.company), h('div', { class: 'grow' }, h('div', { class: 'strong' }, c.company), h('div', { class: 'help' }, `${c.jobs} matching job${c.jobs > 1 ? 's' : ''}`)), ring(c.best)),
    h('div', { class: 'company-actions' },
      btn('Find HR contacts', 'mail', guard(async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const n = await api.findCompanyContacts(c.company);
          toast(n ? `Added ${n} HR contact${n > 1 ? 's' : ''} at ${c.company}` : `No new HR contacts found at ${c.company}`, n ? 'success' : 'info');
          if (n) loadRecruiters();
        } finally { b.disabled = false; }
      })),
      btn('LinkedIn', 'link', () => browse(c.search))))) : [h('li', {}, emptyState('building', 'No hiring companies yet', 'Companies with matching jobs appear here.'))]));
}

// ---- profile
const split = (s, sep = ',') => s.split(sep).map((x) => x.trim()).filter(Boolean);
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
  f.education.value = p.education ?? '';
  f.salaryAmount.value = p.expectedSalary?.amount ?? '';
  f.salaryCurrency.value = p.expectedSalary?.currency ?? '';
  f.salaryPeriod.value = p.expectedSalary?.period ?? 'month';
  $('#cvFile').textContent = p.cvFile || 'No CV uploaded yet';
  $('#cvMeta').textContent = p.cvFile ? `${p.skills.length} skills · ${p.years} years of experience · ${p.roles.length} target roles` : 'Upload a PDF, DOCX or TXT to fill in your profile.';
  renderRoleSuggestions(p.suggestedRoles || []);
  document.querySelectorAll('[data-key]').forEach((s) => {
    s.textContent = keys[s.dataset.key] ? 'Connected' : 'Not set';
    s.className = `pill ${keys[s.dataset.key] ? 'ok' : 'off'}`;
  });
  return p;
}
// Roles inferred from the CV that aren't in the roles field yet; a click adds one (Save to keep it).
function renderRoleSuggestions(suggested) {
  const field = $('#profileForm').elements.roles;
  const have = split(field.value).map((r) => r.toLowerCase());
  const add = suggested.filter((r) => !have.includes(r.toLowerCase()));
  $('#roleSuggest').replaceChildren(...(add.length ? [h('span', {}, 'Suggested from your CV:'),
    ...add.map((r) => h('button', { type: 'button', title: 'Add to target roles', onclick: () => {
      field.value = [...split(field.value), r].join(', ');
      renderRoleSuggestions(suggested);
    } }, icon('plus'), r))] : []));
}
$('#upload').onclick = guard(async () => {
  const p = await api.uploadCv();
  if (!p) return;
  await loadProfile();
  toast(`CV read: ${p.skills.length} skills, ${p.years} years. Check the fields, then save. Fetching jobs…`, 'success');
  api.refresh();
});
$('#profileForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  await api.saveProfile({ skills: split(f.skills.value), roles: split(f.roles.value), locations: split(f.locations.value, ';'),
    relocate: split(f.relocate.value, ';'), remoteFrom: split(f.remoteFrom.value, ';'), distanceKm: f.distanceKm.value,
    years: f.years.value, minScore: f.minScore.value, adzunaCountry: f.adzunaCountry.value, needsSponsorship: f.needsSponsorship.checked,
    education: f.education.value, salaryAmount: f.salaryAmount.value, salaryCurrency: f.salaryCurrency.value, salaryPeriod: f.salaryPeriod.value });
  $('#minScore').value = f.minScore.value;
  await loadProfile();
  toast('Profile saved. All jobs re-scored.', 'success');
}));
$('#keysForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  await api.saveKeys({ jsearchKey: f.jsearchKey.value, adzunaId: f.adzunaId.value, adzunaKey: f.adzunaKey.value, hunterKey: f.hunterKey.value, reedKey: f.reedKey.value });
  e.target.reset();
  await loadProfile();
  toast('Keys saved. Refreshing…', 'success');
  api.refresh();
}));

// ---- live sync status
function renderSync(r) {
  const errs = Object.entries(r.status).filter(([, v]) => v.startsWith('error'));
  $('#syncDot').className = `dot ${errs.length ? 'warn' : 'ok'}`;
  $('#syncText').textContent = `Updated ${new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${r.fetched} scanned`;
  $('#syncSources').replaceChildren(...Object.entries(r.status).map(([k, v]) =>
    h('span', { title: `${k}: ${v}` }, h('span', { class: `dot ${v.startsWith('error') ? 'bad' : v === 'no API key' ? '' : 'ok'}` }), k)));
}
api.on('refreshing', (on) => {
  $('#progress').hidden = !on;
  $('#refresh').disabled = on;
  $('#refresh').classList.toggle('busy', on);
  if (on) { $('#syncDot').className = 'dot busy'; $('#syncText').textContent = 'Refreshing jobs…'; }
});
api.on('updated', (r) => {
  renderSync(r);
  if (r.fresh) toast(`${r.fresh} new matching job${r.fresh > 1 ? 's' : ''}`, 'success');
  if (!$('#feed').hidden) loadJobs(); else loadStats();
  if (!$('#today').hidden) loadToday();
  updateBadge();
});
api.on('goto', show);

// Start once every view script (today.js, review.js, …) has loaded.
document.addEventListener('DOMContentLoaded', async () => {
  const p = await loadProfile();
  $('#minScore').value = p.minScore;
  show(p.skills.length ? 'today' : 'profile');
  loadStats();
  updateBadge();
});
