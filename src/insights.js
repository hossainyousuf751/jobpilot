// Briefing ("Today") and market insights, computed from local job data. Pure functions, no I/O.

const DAY = 864e5;
// SQLite "2026-10-26 10:00:00" is UTC.
const ts = (s) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

// "BDT 30,000-50,000 / month" → { currency, lo, hi, period }; null when there are no numbers.
function parseSalary(s) {
  const m = /^(?:([A-Z]{3})\s+)?([\d,]+)(?:\s*-\s*([\d,]+))?(?:\s*\/\s*(\w+))?/.exec(String(s || '').trim());
  if (!m) return null;
  const n = (x) => Number(x.replace(/,/g, ''));
  return { currency: m[1] || '', lo: n(m[2]), hi: m[3] ? n(m[3]) : n(m[2]), period: m[4] || '' };
}

// What changed since lastSeen and what to do next.
function briefing({ matches, mine, queue, lastSeen, now = Date.now() }) {
  const seen = ts(lastSeen) || now - DAY;
  const days = (j) => Math.floor((now - ts(j.stage_at || j.found_at)) / DAY);
  return {
    newSince: matches.filter((j) => ts(j.found_at) > seen).length,
    // Applied a week or more ago and still at "applied": time to nudge the recruiter.
    followUps: mine.filter((j) => j.status === 'applied' && (j.stage || 'applied') === 'applied' && days(j) >= 7)
      .map((j) => ({ ...j, days: days(j) })).sort((a, b) => b.days - a.days),
    interviews: mine.filter((j) => j.stage === 'interview'),
    freshFits: matches.filter((j) => j.status === 'new' && j.reasons.notes.includes('Strong CV fit') && now - ts(j.found_at) < 3 * DAY)
      .sort((a, b) => b.score - a.score).slice(0, 3),
    toReview: queue,
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Market view over your matches: skill demand vs your skills, salary bands, daily flow, sources.
function insights(matches, now = Date.now()) {
  const skillCount = new Map();
  for (const j of matches) {
    for (const s of j.reasons.matched) skillCount.set(s, { n: (skillCount.get(s)?.n || 0) + 1, have: true });
    for (const s of j.reasons.missing) skillCount.set(s, { n: (skillCount.get(s)?.n || 0) + 1, have: skillCount.get(s)?.have || false });
  }
  const skills = [...skillCount].map(([skill, v]) => ({ skill, n: v.n, have: v.have })).sort((a, b) => b.n - a.n || a.skill.localeCompare(b.skill)).slice(0, 14);

  const bands = new Map();
  for (const j of matches) {
    const p = parseSalary(j.salary);
    if (!p || !p.currency || !p.period) continue;
    const key = `${p.currency}/${p.period}`;
    bands.set(key, [...(bands.get(key) || []), p]);
  }
  const salaries = [...bands].map(([key, ps]) => {
    const [currency, period] = key.split('/');
    return { currency, period, n: ps.length, min: Math.min(...ps.map((p) => p.lo)), max: Math.max(...ps.map((p) => p.hi)), median: median(ps.map((p) => (p.lo + p.hi) / 2)) };
  }).sort((a, b) => b.n - a.n).slice(0, 4);

  const today = Math.floor(now / DAY);
  const perDay = Array.from({ length: 14 }, (_, i) => {
    const d = today - 13 + i;
    return { date: new Date(d * DAY).toISOString().slice(0, 10), n: matches.filter((j) => Math.floor(ts(j.found_at) / DAY) === d).length };
  });

  const src = new Map();
  for (const j of matches) src.set(j.source, (src.get(j.source) || 0) + 1);
  const sources = [...src].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n);

  return { skills, salaries, perDay, sources, total: matches.length };
}

module.exports = { parseSalary, briefing, insights };
