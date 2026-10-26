const { DatabaseSync } = require('node:sqlite');

// Same title at the same company (first word of its name) on several sites: keep the best-scoring one,
// remember the other sites in `also`. ponytail: O(n²) over ≤500 rows; key a Map if the feed limit grows.
const dupKey = (j) => `${j.title.toLowerCase().replace(/\W+/g, ' ').trim()}|${(j.company || '').toLowerCase().split(/\W+/)[0]}`;
function dedupe(list, j) {
  const i = list.findIndex((x) => dupKey(x) === dupKey(j));
  if (i < 0) return list.push({ ...j, also: [] }), list;
  const [keep, drop] = j.score > list[i].score ? [{ ...j, also: list[i].also }, list[i]] : [list[i], j];
  keep.also = [...new Set([...keep.also, drop.source])].filter((s) => s !== keep.source);
  list[i] = keep;
  return list;
}

function open(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, company TEXT, location TEXT,
      remote INTEGER NOT NULL DEFAULT 0, url TEXT NOT NULL, description TEXT, posted_at TEXT,
      score INTEGER NOT NULL, eligible INTEGER NOT NULL, reasons TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'applied', 'hidden')),
      found_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS jobs_feed ON jobs (eligible, score, found_at);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), read INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('cv', 'letter')), name TEXT NOT NULL, data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS recruiters (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, title TEXT, company TEXT,
      profile_url TEXT UNIQUE, email TEXT UNIQUE, job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'requested', 'connected', 'ignored')),
      found_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);

  // Added after v1: idempotent column additions.
  for (const col of ['company_url TEXT', 'job_type TEXT', 'salary TEXT',
    "stage TEXT CHECK (stage IN ('applied', 'interview', 'offer', 'rejected'))", 'stage_at TEXT', 'reviewed INTEGER NOT NULL DEFAULT 0', 'applicants INTEGER']) {
    try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col}`); } catch { /* already there */ }
  }

  const q = (sql) => db.prepare(sql);
  const insJob = q(`INSERT OR IGNORE INTO jobs (id, source, title, company, location, remote, url, description, posted_at, score, eligible, reasons, company_url, job_type, salary, applicants)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const rescore = q('UPDATE jobs SET score = ?, eligible = ?, reasons = ? WHERE id = ?');
  // A refetch may bring what the first fetch missed (e.g. LinkedIn description request was rate-limited).
  const fillIn = q(`UPDATE jobs SET company_url = COALESCE(?, company_url), job_type = COALESCE(?, job_type), salary = COALESCE(?, salary), applicants = COALESCE(?, applicants),
                    description = CASE WHEN length(?) > length(description) THEN ? ELSE description END WHERE id = ?`);
  const insRec = q(`INSERT OR IGNORE INTO recruiters (name, title, company, profile_url, email, job_id, source) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const parse = (j) => ({ ...j, reasons: JSON.parse(j.reasons) });

  return {
    getProfile: () => { const r = q('SELECT data FROM profile WHERE id = 1').get(); return r && JSON.parse(r.data); },
    saveProfile: (p) => q('INSERT INTO profile (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(JSON.stringify(p)),
    jobCount: () => q('SELECT COUNT(*) n FROM jobs').get().n,

    // Returns true when the job is new.
    upsertJob(j, m) {
      const reasons = JSON.stringify(m.reasons);
      const r = insJob.run(j.id, j.source, j.title, j.company || '', j.location || '', j.remote ? 1 : 0, j.url,
        j.description || '', j.posted_at || '', m.score, m.eligible ? 1 : 0, reasons, j.company_url || null, j.job_type || null, j.salary || null, j.applicants ?? null);
      if (!r.changes) { rescore.run(m.score, m.eligible ? 1 : 0, reasons, j.id); fillIn.run(j.company_url || null, j.job_type || null, j.salary || null, j.applicants ?? null, j.description || '', j.description || '', j.id); }
      return r.changes > 0;
    },
    allJobs: () => q('SELECT * FROM jobs').all(),
    rescore: (id, m) => rescore.run(m.score, m.eligible ? 1 : 0, JSON.stringify(m.reasons), id),
    // scope 'matches' (default): eligible and score ≥ minScore; 'all': every job not hidden. Filters are already validated in main.js.
    listJobs(f = {}) {
      const where = ["status != 'hidden'"], args = [];
      // ISO "2026-10-25T03:55" → "2026-10-25 03:55" so it compares correctly with SQLite datetimes; date-only = midnight.
      const posted = "replace(COALESCE(NULLIF(posted_at, ''), found_at), 'T', ' ')";
      if (f.scope !== 'all') { where.push('eligible = 1 AND score >= ?'); args.push(f.minScore || 0); }
      if (f.q) { where.push("(title || ' ' || COALESCE(company, '') || ' ' || COALESCE(description, '')) LIKE ?"); args.push(`%${f.q}%`); }
      if (f.location) { where.push('location LIKE ?'); args.push(`%${f.location}%`); }
      if (f.days) { where.push(`${posted} >= datetime('now', ?)`); args.push(`-${f.days} days`); }
      if (f.workplace) where.push(f.workplace === 'remote' ? 'remote = 1' : 'remote = 0');
      if (f.jobType) { where.push('job_type LIKE ?'); args.push(`%${f.jobType}%`); }
      if (f.salaryOnly) where.push('salary IS NOT NULL');
      if (f.unreviewed) where.push("status = 'new' AND reviewed = 0");
      const order = f.sort === 'newest' ? `${posted} DESC, score DESC` : `score DESC, ${posted} DESC`;
      return q(`SELECT id, source, title, company, location, remote, url, posted_at, score, eligible, reasons, status, stage, found_at, job_type, salary
                FROM jobs WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`).all(...args).map(parse).reduce(dedupe, []);
    },
    // Dashboard numbers; "new today" = found in the last 24 h among matches.
    stats: (minScore) => Object.fromEntries(Object.entries(q(`SELECT
        SUM(eligible = 1 AND score >= ? AND status != 'hidden') matches,
        SUM(eligible = 1 AND score >= ? AND status != 'hidden' AND found_at >= datetime('now', '-1 day')) newToday,
        SUM(eligible = 1 AND score >= ? AND status != 'hidden' AND reasons LIKE '%Strong CV fit%') strong,
        SUM(status != 'hidden') total, SUM(status = 'saved') saved,
        SUM(status = 'applied' AND COALESCE(stage, 'applied') = 'applied') applied,
        SUM(stage = 'interview') interview, SUM(stage = 'offer') offer
      FROM jobs`).get(minScore, minScore, minScore)).map(([k, v]) => [k, v || 0])),
    getJob: (id) => { const j = q('SELECT * FROM jobs WHERE id = ?').get(id); return j && parse(j); },
    myJobs: () => q(`SELECT id, source, title, company, location, remote, url, posted_at, score, eligible, reasons, status, stage, stage_at, found_at, job_type, salary
                     FROM jobs WHERE status IN ('saved', 'applied') ORDER BY found_at DESC`).all().map(parse),
    // A stage only exists while applied; any other status clears it.
    // Any decision on a job counts as reviewed; saving/applying stamps stage_at for follow-up reminders.
    setJobStatus: (id, status) => q(`UPDATE jobs SET status = ?, reviewed = 1,
      stage = CASE WHEN ? = 'applied' THEN COALESCE(stage, 'applied') END,
      stage_at = CASE WHEN ? IN ('saved', 'applied') AND status != ? THEN datetime('now') ELSE stage_at END WHERE id = ?`).run(status, status, status, status, id),
    setJobStage: (id, stage) => q(`UPDATE jobs SET status = 'applied', stage = ?, reviewed = 1, stage_at = datetime('now') WHERE id = ?`).run(stage, id),
    // Training labels for calibration: kept (saved/applied) = 1, dropped (passed in review or hidden) = 0.
    decisions: () => q(`SELECT id, status, reasons FROM jobs WHERE status IN ('saved', 'applied', 'hidden') OR (status = 'new' AND reviewed = 1)`).all()
      .map((r) => ({ id: r.id, parts: JSON.parse(r.reasons).parts || {}, label: r.status === 'saved' || r.status === 'applied' ? 1 : 0 }))
      .filter((r) => Object.keys(r.parts).length),
    // CV and cover-letter documents (builder data as JSON).
    listDocs: (kind) => q('SELECT id, name, updated_at FROM documents WHERE kind = ? ORDER BY updated_at DESC, name').all(kind),
    getDoc: (id) => { const r = q('SELECT * FROM documents WHERE id = ?').get(id); return r && { ...r, data: JSON.parse(r.data) }; },
    saveDoc: ({ id, kind, name, data }) => q(`INSERT INTO documents (id, kind, name, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = datetime('now')`).run(id, kind, name, JSON.stringify(data)),
    deleteDoc: (id) => q('DELETE FROM documents WHERE id = ?').run(id),
    markReviewed: (id) => q('UPDATE jobs SET reviewed = 1 WHERE id = ?').run(id),
    // Undo of a review-deck decision: the deck only shows status 'new' jobs, so 'new' is the state to restore.
    undoReview: (id) => q("UPDATE jobs SET reviewed = 0, status = 'new', stage = NULL WHERE id = ?").run(id),
    prune: () => {
      q(`DELETE FROM jobs WHERE status IN ('new', 'hidden') AND found_at < datetime('now', '-30 days')`).run();
      // Contacts you never acted on are personal data with no use after 90 days.
      q(`DELETE FROM recruiters WHERE status IN ('new', 'ignored') AND found_at < datetime('now', '-90 days')`).run();
    },

    addAlert: (jobId) => q('INSERT OR IGNORE INTO alerts (job_id) VALUES (?)').run(jobId),
    listAlerts: () => q(`SELECT a.id, a.read, a.created_at, j.id job_id, j.title, j.company, j.location, j.url, j.score, j.source
                         FROM alerts a JOIN jobs j ON j.id = a.job_id ORDER BY a.id DESC LIMIT 200`).all(),
    unreadAlerts: () => q('SELECT COUNT(*) n FROM alerts WHERE read = 0').get().n,
    readAlerts: () => q('UPDATE alerts SET read = 1 WHERE read = 0').run(),

    addRecruiter: (r, source) => insRec.run(r.name, r.title || '', r.company || '', r.profile_url || null, r.email || null, r.job_id || null, source).changes > 0,
    listRecruiters: () => q(`SELECT r.*, j.title job_title FROM recruiters r LEFT JOIN jobs j ON j.id = r.job_id
                             WHERE r.status != 'ignored' ORDER BY r.id DESC`).all(),
    setRecruiterStatus: (id, status) => q('UPDATE recruiters SET status = ? WHERE id = ?').run(status, id),
    description: (id) => q('SELECT description FROM jobs WHERE id = ?').get(id)?.description || '',
    companyUrl: (company) => q('SELECT MAX(company_url) u FROM jobs WHERE company = ?').get(company)?.u || null,
    hiringCompanies: (minScore) => q(`SELECT company, COUNT(*) jobs, MAX(score) best FROM jobs
                                      WHERE eligible = 1 AND score >= ? AND company != '' AND status != 'hidden'
                                      GROUP BY company ORDER BY best DESC, jobs DESC LIMIT 60`).all(minScore),
  };
}

module.exports = { open };
