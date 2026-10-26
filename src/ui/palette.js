// Command palette (Ctrl+K): jump to any page, run any action, open any job.
const PAGES = [['today', 'Today', 'sun'], ['review', 'Review matches', 'layers'], ['feed', 'Matches', 'target'], ['all', 'All jobs', 'list'],
  ['myjobs', 'My jobs', 'briefcase'], ['alerts', 'Alerts', 'bell'], ['recruiters', 'Recruiters', 'users'], ['insights', 'Insights', 'chart'],
  ['browser', 'Portals', 'globe'], ['profile', 'Profile & CV', 'user']];
const ACTIONS = [
  ['Refresh jobs now', 'refresh', () => guard(async () => { const r = await api.refresh(); if (r?.error) toast(r.error, 'error'); })()],
  ['Upload a new CV', 'upload', () => { show('profile'); $('#upload').click(); }],
  ['Open LinkedIn Jobs', 'link', () => browse('https://www.linkedin.com/jobs/')],
  ['Open Bdjobs', 'globe', () => browse('https://www.bdjobs.com/')],
  ['Mark all alerts read', 'check', () => guard(async () => { await api.readAlerts(); updateBadge(); toast('All alerts marked as read', 'success'); })()],
];

let paletteItems = [], paletteIndex = 0, paletteTimer;
const fuzzy = (q, s) => s.toLowerCase().includes(q.toLowerCase());

async function renderPalette() {
  const q = $('#paletteQ').value.trim();
  const pages = PAGES.filter(([, label]) => !q || fuzzy(q, label)).map(([tab, label, ic]) => ({ group: 'Go to', label, ic, run: () => show(tab) }));
  const actions = ACTIONS.filter(([label]) => !q || fuzzy(q, label)).map(([label, ic, run]) => ({ group: 'Actions', label, ic, run }));
  const jobs = q.length >= 2 ? (await api.listJobs({ scope: 'all', q, sort: 'match' })).slice(0, 8)
    .map((j) => ({ group: 'Jobs', label: j.title, hint: [j.company, j.location].filter(Boolean).join(' · '), job: j, run: () => openJob(j.id) })) : [];
  paletteItems = q ? [...jobs, ...pages, ...actions] : [...pages, ...actions];
  paletteIndex = 0;
  let group = '';
  const rows = [];
  paletteItems.forEach((it, i) => {
    if (it.group !== group) { group = it.group; rows.push(h('li', { class: 'palette-group', role: 'presentation' }, group)); }
    rows.push(h('li', { class: 'palette-item', role: 'option', 'data-i': i, onmousemove: () => movePalette(i, false), onclick: () => runPalette(i) },
      it.job ? avatar(it.job.company || it.label, 'sm') : h('span', { class: 'palette-ic' }, icon(it.ic)),
      h('div', { class: 'grow' }, h('div', { class: 'clip' }, it.label), it.hint && h('div', { class: 'help clip' }, it.hint)),
      it.job ? ring(it.job.score, !!it.job.eligible) : null));
  });
  $('#paletteList').replaceChildren(...(rows.length ? rows : [h('li', { class: 'palette-empty' }, `Nothing matches “${q}”`)]));
  movePalette(0);
}
function movePalette(i, scroll = true) {
  paletteIndex = Math.max(0, Math.min(paletteItems.length - 1, i));
  document.querySelectorAll('.palette-item').forEach((el) => el.setAttribute('aria-selected', +el.dataset.i === paletteIndex));
  if (scroll) document.querySelector(`.palette-item[data-i="${paletteIndex}"]`)?.scrollIntoView({ block: 'nearest' });
}
function runPalette(i) {
  const it = paletteItems[i];
  if (!it) return;
  $('#palette').close();
  it.run();
}
function openPalette() {
  if ($('#palette').open) return;
  $('#paletteQ').value = '';
  $('#palette').showModal();
  renderPalette();
}

$('#openPalette').onclick = openPalette;
$('#paletteQ').addEventListener('input', () => { clearTimeout(paletteTimer); paletteTimer = setTimeout(guard(renderPalette), 120); });
$('#paletteQ').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(paletteIndex + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(paletteIndex - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
});
$('#palette').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }); // click on backdrop
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});
