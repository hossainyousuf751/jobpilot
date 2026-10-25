const { app, BrowserWindow, ipcMain, dialog, Notification, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./db');
const { fetchAll, hunterContacts } = require('./sources');
const { buildProfile, scoreJob } = require('./match');
const { contactsFromText, peopleSearchUrl, HIRING_TEAM_SCRIPT } = require('./recruiters');

const POLL_MS = 30 * 60 * 1000;
const DEFAULT_PROFILE = { skills: [], years: 0, roles: [], locations: [], distanceKm: 50, relocate: [], remoteFrom: [],
  needsSponsorship: false, minScore: 50, adzunaCountry: 'gb' };

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
let running = null, tick = Math.floor(Date.now() / POLL_MS);
function refresh() {
  return (running ??= doRefresh().finally(() => { running = null; }));
}

async function doRefresh() {
  const p = profile();
  if (!p.skills.length) return { error: 'Upload your CV in Profile first.' };
  const firstRun = db.jobCount() === 0;
  const { jobs, status } = await fetchAll(p, loadSecrets(), tick++);
  const fresh = [];
  for (const j of jobs) {
    j.company_url = isHttp(j.company_url) ? str(j.company_url, 300) : null;
    // Score the fuller text: a refetch can come back without the description the first fetch got.
    const stored = db.description(j.id);
    if (stored.length > (j.description || '').length) j.description = stored;
    const m = scoreJob(p, j);
    if (db.upsertJob(j, m) && m.eligible && m.score >= p.minScore) fresh.push(j);
    // Emails the job site listed (JobSpy) count like ones found in the description.
    const text = `${j.description || ''}\n${(Array.isArray(j.emails) ? j.emails : []).join(' ')}`;
    if (m.eligible) for (const c of contactsFromText(text)) db.addRecruiter({ ...c, company: j.company, job_id: j.id }, 'job posting');
  }
  db.prune();
  // First run would alert on everything; just fill the feed.
  if (!firstRun) for (const j of fresh) db.addAlert(j.id);
  if (!firstRun && fresh.length && Notification.isSupported()) {
    const n = new Notification({ title: `${fresh.length} new job${fresh.length > 1 ? 's' : ''} for you`, body: fresh.slice(0, 3).map((j) => `${j.title} · ${j.company}`).join('\n') });
    n.on('click', () => { win.show(); win.focus(); send('goto', 'alerts'); });
    n.show();
    win.flashFrame(true);
  }
  const result = { at: new Date().toISOString(), fetched: jobs.length, fresh: fresh.length, status };
  log('info', 'refresh', result);
  send('updated', result);
  return result;
}

function rescoreAll() {
  const p = profile();
  for (const j of db.allJobs()) db.rescore(j.id, scoreJob(p, j));
}

const handlers = {
  getProfile: () => ({ profile: profile(), keys: Object.fromEntries(Object.entries(loadSecrets()).map(([k, v]) => [k, !!v])) }),

  async uploadCv() {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'CV', extensions: ['pdf', 'docx', 'txt', 'md'] }], properties: ['openFile'] });
    if (canceled) return null;
    const f = filePaths[0], ext = path.extname(f).toLowerCase(), buf = fs.readFileSync(f);
    // pdf.js rejects with plain objects; turn them into a readable message.
    const text = ext === '.pdf' ? (await require('pdf-parse/lib/pdf-parse.js')(buf).catch((e) => { throw new Error(`Could not read that PDF (${e?.message || e}). Try a DOCX or TXT export.`); })).text
      : ext === '.docx' ? (await require('mammoth').extractRawText({ buffer: buf })).value
      : buf.toString('utf8');
    if (text.trim().length < 50) throw new Error('Could not read text from that file (scanned PDF?). Try a DOCX or TXT export.');
    const p = { ...profile(), ...buildProfile(text), cvFile: path.basename(f) };
    db.saveProfile(p);
    rescoreAll();
    log('info', 'cv uploaded', { skills: p.skills.length, years: p.years });
    return p;
  },

  saveProfile(_, input) {
    const list = (v) => (Array.isArray(v) ? v : []).map((s) => str(s, 80)).filter(Boolean).slice(0, 200);
    const p = { ...profile(), skills: list(input.skills), roles: list(input.roles).slice(0, 5), locations: list(input.locations).slice(0, 5),
      relocate: list(input.relocate).slice(0, 20), remoteFrom: list(input.remoteFrom).slice(0, 10),
      distanceKm: Math.max(1, Math.min(500, +input.distanceKm || 50)),
      years: Math.max(0, Math.min(50, +input.years || 0)), minScore: Math.max(0, Math.min(100, +input.minScore || 0)),
      needsSponsorship: !!input.needsSponsorship, adzunaCountry: str(input.adzunaCountry, 2).toLowerCase() || 'gb' };
    db.saveProfile(p);
    rescoreAll();
    return p;
  },

  saveKeys(_, keys) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable; keys not saved.');
    const s = loadSecrets();
    for (const k of ['jsearchKey', 'adzunaId', 'adzunaKey', 'hunterKey']) if (str(keys[k])) s[k] = str(keys[k]);
    fs.writeFileSync(file('secrets.bin'), safeStorage.encryptString(JSON.stringify(s)));
  },

  refresh: () => refresh(),
  listJobs: (_, opts) => db.listJobs(opts),
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
  openExternal: (_, url) => (isHttp(url) || /^mailto:[^\s/]+@[^\s/]+$/i.test(url)) && shell.openExternal(url),
};

// One instance: a second copy would double-poll and share the DB.
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

app.setAppUserModelId('JobPilot'); // Windows only shows toasts for apps with an id
app.whenReady().then(() => {
  db = open(file('jobpilot.db'));
  rescoreAll(); // scoring rules may have changed since jobs were stored; ~1 s for 700 jobs
  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, fn);

  win = new BrowserWindow({
    width: 1400, height: 900, title: 'JobPilot', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, webviewTag: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));

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
