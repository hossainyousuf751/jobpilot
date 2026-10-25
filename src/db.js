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
    CREATE TABLE IF NOT EXISTS recruiters (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, title TEXT, company TEXT,
      profile_url TEXT UNIQUE, email TEXT UNIQUE, job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'requested', 'connected', 'ignored')),
      found_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);

  // Added after v1: idempotent column additions.
  try { db.exec('ALTER TABLE jobs ADD COLUMN company_url TEXT'); } catch { /* already there */ }

  const q = (sql) => db.prepare(sql);
  const insJob = q(`INSERT OR IGNORE INTO jobs (id, source, title, company, location, remote, url, description, posted_at, score, eligible, reasons, company_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const rescore = q('UPDATE jobs SET score = ?, eligible = ?, reasons = ? WHERE id = ?');
  // A refetch may bring what the first fetch missed (e.g. LinkedIn description request was rate-limited).
  const fillIn = q(`UPDATE jobs SET company_url = COALESCE(?, company_url),
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
        j.description || '', j.posted_at || '', m.score, m.eligible ? 1 : 0, reasons, j.company_url || null);
      if (!r.changes) { rescore.run(m.score, m.eligible ? 1 : 0, reasons, j.id); fillIn.run(j.company_url || null, j.description || '', j.description || '', j.id); }
      return r.changes > 0;
    },
    allJobs: () => q('SELECT * FROM jobs').all(),
    rescore: (id, m) => rescore.run(m.score, m.eligible ? 1 : 0, JSON.stringify(m.reasons), id),
    listJobs: ({ minScore = 0, showIneligible = false } = {}) =>
      q(`SELECT id, source, title, company, location, remote, url, posted_at, score, eligible, reasons, status, found_at
         FROM jobs WHERE status != 'hidden' AND (eligible = 1 OR ?) AND score >= ?
         ORDER BY found_at DESC, score DESC LIMIT 500`).all(showIneligible ? 1 : 0, minScore).map(parse).reduce(dedupe, []),
    setJobStatus: (id, status) => q('UPDATE jobs SET status = ? WHERE id = ?').run(status, id),
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
