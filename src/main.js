const { app, BrowserWindow, ipcMain, dialog, Notification, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./db');
const { fetchAll, cleanJob, hunterContacts, fetchRates, parseRates } = require('./sources');
const { DEFAULT_PROFILE, profileFromForm, buildProfile, buildCorpus, scoreJob, calibrate, PRIOR_WEIGHTS } = require('./match');
const { briefing, insights, jobFilters } = require('./insights');
const { newCv, parseCvText, uid } = require('./cvdoc');
const { pathToFileURL } = require('node:url');
const { contactsFromText, peopleSearchUrl, HIRING_TEAM_SCRIPT } = require('./recruiters');

const POLL_MS = 30 * 60 * 1000;

let win, db;
const file = (name) => path.join(app.getPath('userData'), name);

function log(level, msg, extra) {
  fs.appendFile(file('app.log'), JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }) + '\n', () => {});
}

function loadSecrets() {
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file('secrets.bin')))); } catch { return {}; }
}

const profile = () => ({ ...DEFAULT_PROFILE, ...db.getProfile() });
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Rotation counter starts from the clock so restarts carry on where the schedule is, not from the first country.
let lastRefresh = null; // shown in the sidebar until the next refresh

// Exchange rates for the pay metric: cached in userData/fx.json, re-fetched at most once a day; stale rates beat none.
let fx = null;
function loadFxCache() {
  try { const d = JSON.parse(fs.readFileSync(file('fx.json'), 'utf8')); const r = parseRates(d); if (r) fx = { ...r, fetched: d.fetched }; } catch { /* first run */ }
}
async function updateFx() {
  const today = new Date().toISOString().slice(0, 10);
  if (fx?.fetched === today) return;
  try {
    const r = await fetchRates();
    fx = { ...r, fetched: today };
    fs.writeFileSync(file('fx.json'), JSON.stringify({ date: r.date, fetched: today, usd: r.rates }));
  } catch (e) { log('warn', 'fx', { err: e.message, using: fx?.date || 'none' }); }
}
let running = null, tick = Math.floor(Date.now() / POLL_MS);
function refresh() {
  return (running ??= doRefresh().finally(() => { running = null; send('refreshing', false); }));
}

async function doRefresh() {
  const p = profile();
  if (!p.skills.length) return { error: 'Upload your CV in Profile first.' };
  send('refreshing', true);
  await updateFx();
  const firstRun = db.jobCount() === 0;
  const { jobs, status } = await fetchAll(p, loadSecrets(), tick++);
  const fresh = [];
  const corpus = { ...buildCorpus([...db.allJobs(), ...jobs]), fx };
  for (const j of jobs) {
    cleanJob(j);
    // Score the fuller text: a refetch can come back without the description the first fetch got.
    const stored = db.description(j.id);
    if (stored.length > (j.description || '').length) j.description = stored;
    const m = scoreJob(p, j, corpus);
    if (db.upsertJob(j, m) && m.eligible && m.score >= p.minScore) fresh.push(j);
    // Emails the job site listed (JobSpy) count like ones found in the description.
    const text = `${j.description || ''}\n${(Array.isArray(j.emails) ? j.emails : []).join(' ')}`;
    if (m.eligible) for (const c of contactsFromText(text)) db.addRecruiter({ ...c, company: j.company, job_id: j.id }, 'job posting');
  }
  db.prune();
  rescoreAll(); // recalibrate on decisions made since the last refresh
  // First run would alert on everything; just fill the feed.
  if (!firstRun) for (const j of fresh) db.addAlert(j.id);
  if (!firstRun && fresh.length && Notification.isSupported()) {
    const n = new Notification({ title: `${fresh.length} new job${fresh.length > 1 ? 's' : ''} for you`, body: fresh.slice(0, 3).map((j) => `${j.title} · ${j.company}`).join('\n') });
    n.on('click', () => { win.show(); win.focus(); send('goto', 'alerts'); });
    n.show();
    win.flashFrame(true);
  }
  const result = { at: new Date().toISOString(), fetched: jobs.length, fresh: fresh.length, status };
  lastRefresh = result;
  log('info', 'refresh', result);
  send('updated', result);
  return result;
}

// Learn metric weights from the user's decisions first (they use stored per-metric parts, which don't depend on weights),
// then re-score every job with them. Runs at startup and on each refresh, not on every decision (~1 s for 1,400 jobs).
function rescoreAll() {
  const calibration = calibrate(db.decisions());
  db.saveProfile({ ...profile(), calibration });
  const p = profile();
  const all = db.allJobs(), corpus = { ...buildCorpus(all), fx };
  for (const j of all) db.rescore(j.id, scoreJob(p, j, corpus));
}

// Ask for a CV file and return its text (PDF, DOCX, TXT/MD).
async function pickCvText() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'CV', extensions: ['pdf', 'docx', 'txt', 'md'] }], properties: ['openFile'] });
  if (canceled) return null;
  const f = filePaths[0], ext = path.extname(f).toLowerCase(), buf = fs.readFileSync(f);
  // pdf.js rejects with plain objects; turn them into a readable message.
  const text = ext === '.pdf' ? (await require('pdf-parse/lib/pdf-parse.js')(buf).catch((e) => { throw new Error(`Could not read that PDF (${e?.message || e}). Try a DOCX or TXT export.`); })).text
    : ext === '.docx' ? (await require('mammoth').extractRawText({ buffer: buf })).value
    : buf.toString('utf8');
  if (text.trim().length < 50) throw new Error('Could not read text from that file (scanned PDF?). Try a DOCX or TXT export.');
  return { f, text };
}

// Render document HTML (built by the renderer, text already escaped by the DOM) to an A4 PDF in a hidden window
// with JavaScript off and a CSP that only allows the app's document stylesheet.
let printWin = null;
async function htmlToPdf(bodyHtml) {
  const css = pathToFileURL(path.join(__dirname, 'ui', 'doc.css')).href;
  const page = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src file: 'unsafe-inline'; font-src file:; img-src data:">
<link rel="stylesheet" href="${css}"></head><body class="print">${bodyHtml}</body></html>`;
  const tmp = file('print.html');
  fs.writeFileSync(tmp, page);
  // One hidden window, reused: destroying it and creating a new one right away made the next export fail (ERR_FAILED).
  if (!printWin || printWin.isDestroyed()) printWin = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
  try {
    await printWin.loadFile(tmp);
    return await printWin.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
  } finally { fs.rm(tmp, () => {}); }
}

const handlers = {
  getProfile: () => ({ profile: profile(), keys: Object.fromEntries(Object.entries(loadSecrets()).map(([k, v]) => [k, !!v])) }),

  async uploadCv() {
    const picked = await pickCvText();
    if (!picked) return null;
    const { f, text } = picked;
    const p = { ...profile(), ...buildProfile(text), cvFile: path.basename(f) };
    db.saveProfile(p);
    rescoreAll();
    log('info', 'cv uploaded', { skills: p.skills.length, years: p.years });
    return p;
  },

  saveProfile(_, input) {
    const p = profileFromForm(profile(), input);
    db.saveProfile(p);
    rescoreAll();
    return p;
  },

  saveKeys(_, keys) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable; keys not saved.');
    const s = loadSecrets();
    for (const k of ['jsearchKey', 'adzunaId', 'adzunaKey', 'hunterKey', 'reedKey']) if (str(keys[k])) s[k] = str(keys[k]);
    fs.writeFileSync(file('secrets.bin'), safeStorage.encryptString(JSON.stringify(s)));
  },

  refresh: () => refresh(),
  listJobs: (_, f) => db.listJobs(jobFilters(f)),
  getJob: (_, id) => db.getJob(str(id)),
  myJobs: () => db.myJobs(),
  reviewQueue: () => db.listJobs({ scope: 'matches', minScore: profile().minScore, unreviewed: true, sort: 'match' }),
  markReviewed: (_, id) => db.markReviewed(str(id)),
  undoReview: (_, id) => db.undoReview(str(id)),
  briefing(_, lastSeen) {
    const matches = db.listJobs({ scope: 'matches', minScore: profile().minScore });
    const queue = db.listJobs({ scope: 'matches', minScore: profile().minScore, unreviewed: true }).length;
    const seen = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(lastSeen || '') ? lastSeen : null;
    return briefing({ matches, mine: db.myJobs(), queue, lastSeen: seen });
  },
  insights: () => insights(db.listJobs({ scope: 'matches', minScore: profile().minScore })),
  // Match numbers come from the same de-duplicated list the feed shows, so tiles and list agree.
  stats() {
    const min = profile().minScore, list = db.listJobs({ scope: 'matches', minScore: min });
    const dayAgo = Date.now() - 864e5;
    const cal = profile().calibration;
    return { ...db.stats(min), matches: list.length, last: lastRefresh, priorWeights: PRIOR_WEIGHTS,
      calibration: cal || { active: false, n: 0, pos: 0, neg: 0, weights: PRIOR_WEIGHTS },
      toReview: db.listJobs({ scope: 'matches', minScore: min, unreviewed: true }).length,
      newToday: list.filter((j) => new Date(`${j.found_at.replace(' ', 'T')}Z`) >= dayAgo).length,
      strong: list.filter((j) => j.reasons.notes.includes('Strong CV fit')).length };
  },
  setJobStage: (_, id, stage) => db.setJobStage(str(id), str(stage)),
  setJobStatus: (_, id, status) => db.setJobStatus(str(id), str(status)),
  listAlerts: () => db.listAlerts(),
  unreadAlerts: () => db.unreadAlerts(),
  readAlerts: () => db.readAlerts(),
  listRecruiters: () => ({ people: db.listRecruiters(), companies: db.hiringCompanies(profile().minScore).map((c) => ({ ...c, search: peopleSearchUrl(c.company) })) }),
  setRecruiterStatus: (_, id, status) => db.setRecruiterStatus(+id, str(status)),
  hiringTeamScript: () => HIRING_TEAM_SCRIPT,

  // Data scraped from the page the user is viewing: untrusted, validate.
  addRecruiters(_, list) {
    let added = 0;
    for (const r of (Array.isArray(list) ? list : []).slice(0, 20)) {
      const url = str(r.profile_url, 200);
      if (!/^https:\/\/([a-z]+\.)?linkedin\.com\/in\/[\w%-]+$/i.test(url) || !str(r.name)) continue;
      if (db.addRecruiter({ name: str(r.name, 100), title: str(r.title, 200), company: str(r.company, 100), profile_url: url }, `LinkedIn hiring team${r.job_title ? `: ${str(r.job_title, 100)}` : ''}`)) added++;
    }
    return added;
  },
  // On demand only: Hunter's free plan allows few searches a month.
  async findCompanyContacts(_, company) {
    const name = str(company, 100);
    const key = loadSecrets().hunterKey;
    if (!name) return 0;
    if (!key) throw new Error('Add a Hunter.io API key in Profile first.');
    let added = 0;
    for (const r of (await hunterContacts(name, db.companyUrl(name), key)).slice(0, 20)) {
      const email = str(r.email, 200);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      const li = str(r.profile_url, 200);
      if (db.addRecruiter({ name: str(r.name, 100) || email, title: str(r.title, 200), company: name, email,
        profile_url: /^https:\/\/([a-z]+\.)?linkedin\.com\/in\/[\w%-]+\/?$/i.test(li) ? li : null }, 'Hunter.io (HR)')) added++;
    }
    log('info', 'hunter search', { added });
    return added;
  },
  // ---- Documents: CV builder and cover letters
  listDocs: (_, kind) => db.listDocs(kind === 'letter' ? 'letter' : 'cv'),
  getDoc: (_, id) => db.getDoc(str(id, 40)),
  saveDoc(_, doc = {}) {
    const json = JSON.stringify(doc.data ?? null);
    if (!doc.data || typeof doc.data !== 'object' || json.length > 1e6) throw new Error('Document is empty or too large.');
    const id = /^[a-z0-9]{6,40}$/.test(doc.id || '') ? doc.id : uid();
    db.saveDoc({ id, kind: doc.kind === 'letter' ? 'letter' : 'cv', name: str(doc.name, 80) || 'Untitled', data: doc.data });
    return id;
  },
  deleteDoc: (_, id) => db.deleteDoc(str(id, 40)),
  newCv: () => newCv(profile()),
  async importCv() {
    const picked = await pickCvText();
    if (!picked) return null;
    const data = parseCvText(picked.text);
    // Many CV designs show skills as graphics, so the text has no Skills heading: fall back to the profile's skills.
    if (!data.sections.some((s) => s.type === 'skills') && profile().skills.length) data.sections.push({ ...newCv(profile()).sections.find((s) => s.type === 'skills') });
    return { name: path.parse(picked.f).name, data };
  },
  async exportPdf(_, { html, name } = {}) {
    if (typeof html !== 'string' || !html || html.length > 3e6) throw new Error('Nothing to export.');
    const safe = (str(name, 80) || 'Document').replace(/[<>:"/\\|?*]+/g, ' ').trim();
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${safe}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, await htmlToPdf(html));
    return filePath;
  },
  openExternal: (_, url) => (isHttp(url) || /^mailto:[^\s/]+@[^\s/]+$/i.test(url)) && shell.openExternal(url),
};

// One instance: a second copy would double-poll and share the DB.
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

app.setAppUserModelId('JobPilot'); // Windows only shows toasts for apps with an id
app.whenReady().then(() => {
  db = open(file('jobpilot.db'));
  loadFxCache();
  rescoreAll(); // scoring rules may have changed since jobs were stored; ~1 s for 700 jobs
  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, fn);

  win = new BrowserWindow({
    width: 1400, height: 900, title: 'JobPilot', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, webviewTag: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // The hidden print window would otherwise keep the app alive after the main window closes.
  win.on('closed', () => { if (printWin && !printWin.isDestroyed()) printWin.destroy(); });

  setTimeout(refresh, 3000);
  setInterval(refresh, POLL_MS);
});

app.on('web-contents-created', (_, contents) => {
  // Portal webviews: no node, no preload, popups go to our Portals tab.
  contents.on('will-attach-webview', (_e, prefs) => {
    delete prefs.preload;
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true });
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) send('open-url', url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => app.quit());
process.on('unhandledRejection', (e) => log('error', 'unhandled', { err: String(e?.stack || e) }));
