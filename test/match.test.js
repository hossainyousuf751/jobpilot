const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile, cvYears, jobYears, scoreJob } = require('../src/match');
const { contactsFromText } = require('../src/recruiters');

const CV = `Jane Doe
Software Engineer | Acme Ltd
Skills: TypeScript, React, Node.js, PostgreSQL, AWS, Docker
Acme Ltd, Jan 2020 – Present
Beta Corp 2018 - 2020`;

test('profile extraction', () => {
  const p = buildProfile(CV);
  assert.deepEqual(p.skills.sort(), ['AWS', 'Docker', 'Node.js', 'PostgreSQL', 'React', 'TypeScript']);
  assert.equal(cvYears(CV, 2026), 8);
  assert.equal(cvYears('I have 5+ years building APIs'), 5);
  assert.ok(p.roles.includes('Software Engineer'));
});

test('education dates, diplomas and semesters are not experience', () => {
  const cv = `Professional Experience
Acme
Data Analyst
10/2025 – Present
Audit Assistant
01/2024 – 09/2025
Education
BBA, Some University 2018 – 2022
Dean's List (Spring 2021)
Executive Diploma in Leadership and Management`;
  assert.equal(cvYears(cv, 2026), 2);
  const p = buildProfile(cv);
  assert.deepEqual(p.roles.slice(0, 2), ['Data Analyst', 'Audit Assistant'], 'past titles first');
  assert.ok(!p.roles.some((r) => /diploma/i.test(r)));
  assert.ok(!p.skills.includes('Spring'));
});

test('job years', () => {
  assert.equal(jobYears('Requires 3-5 years of professional experience'), 3);
  assert.equal(jobYears('We offer 25 days holiday'), null);
});

const profile = { skills: ['TypeScript', 'React', 'Node.js'], years: 4, roles: ['Software Engineer'], locations: ['London', 'UK'], needsSponsorship: true };
const job = (o) => ({ title: 'Software Engineer', description: 'TypeScript, React and Node.js. 3+ years of experience.', location: 'London, UK', remote: 0, ...o });

test('good match is eligible and scores high', () => {
  const r = scoreJob(profile, job());
  assert.equal(r.eligible, true);
  assert.ok(r.score >= 90, `score ${r.score}`);
});

test('blockers', () => {
  assert.equal(scoreJob(profile, job({ description: 'Needs 10+ years of experience' })).eligible, false);
  assert.equal(scoreJob(profile, job({ location: 'Austin, TX' })).eligible, false);
  assert.equal(scoreJob(profile, job({ location: 'Worldwide', remote: 1 })).eligible, true);
  assert.equal(scoreJob(profile, job({ description: 'React. No visa sponsorship available.' })).eligible, false);
  assert.equal(scoreJob(profile, job({ title: 'Director of Engineering' })).eligible, false);
});

test('location: on-site city, relocation country, remote region', () => {
  const p = { skills: ['Audit'], years: 3, roles: ['Auditor'], locations: ['Dhaka, Bangladesh'], relocate: ['UAE', 'Singapore'], remoteFrom: ['APAC'] };
  const j = (location, remote = 0, description = 'Audit. 2 years of experience.') => scoreJob(p, { title: 'Auditor', description, location, remote });
  assert.equal(j('Dhaka, Dhaka, Bangladesh').eligible, true);
  assert.equal(j('Chittagong, Bangladesh').eligible, false, 'other city, on-site');
  assert.equal(j('Bangladesh', 1).eligible, true, 'remote within home country');
  const dubai = j('Dubai, United Arab Emirates');
  assert.equal(dubai.eligible, true);
  assert.ok(dubai.reasons.notes.includes('Relocation'));
  assert.equal(j('Dubai, UAE', 0, 'Audit. No visa sponsorship.').eligible, false, 'relocation needs a visa');
  assert.equal(scoreJob(p, { title: 'Credit Analyst (UAE National)', description: 'Audit', location: 'Dubai, UAE' }).eligible, false, 'nationals-only title');
  assert.equal(j('Abu Dhabi, UAE', 0, 'Audit. Emiratis only.').eligible, false);
  assert.equal(j('Remote - APAC', 1).eligible, true);
  assert.equal(j('Remote - US', 1).eligible, false);
  assert.equal(j('London, UK').eligible, false);
  assert.equal(j('Worldwide', 1).eligible, true);
});

test('title relevance: word stems count, unrelated titles are penalised', () => {
  const p = { skills: ['Audit', 'Accounting', 'Compliance', 'Research', 'Financial Statements'], years: 3, roles: ['Data Analyst', 'Audit Assistant'], locations: [] };
  const s = (title, description) => scoreJob(p, { title, description, location: '' }).score;
  assert.ok(s('Internal Auditor', 'Audit, accounting and compliance work.') >= 60, 'auditor ~ audit');
  assert.ok(s('Customer Support Specialist', 'Follow compliance and audit rules.') < 50, 'generic words only');
  assert.ok(s('AMD and EADSIM Specialist', 'Research and compliance.') < 50);
});

test('Gulf nationals-only jobs are blocked for relocation', () => {
  const p = { skills: ['Audit'], years: 3, roles: ['Auditor'], locations: ['Dhaka, Bangladesh'], relocate: ['UAE'] };
  const ok = (title) => scoreJob(p, { title, description: 'Audit', location: 'Dubai, United Arab Emirates' }).eligible;
  assert.equal(ok('Site Operations Assistant (Emirati National)'), false);
  assert.equal(ok('Join our Tekamul Program - Emiratization'), false);
  assert.equal(ok('Internal Auditor'), true);
});

test('generic title words alone are not a role match', () => {
  const { scoreJob } = require('../src/match');
  const p = { skills: ['Research'], years: 3, roles: ['Research Assistant', 'Accountant'], locations: [] };
  const s = (title) => scoreJob(p, { title, description: 'Research tasks.', location: '' }).score;
  assert.ok(s('Assistant Purchase & HSE Engineer') < s('Research Officer'), 'assistant alone ≠ research assistant');
  assert.ok(s('Accounts Assistant') > s('Assistant Purchase & HSE Engineer'), 'accounts ~ accountant');
});

const FIN_CV = `Professional Experience
Acme Bank
Data Analyst
10/2025 – Present
Analyze SEC structured product filings, payoff structures, barriers, strikes and maturities. Clean datasets and run data quality checks.
Grant Thornton
Audit Assistant
01/2025 – 09/2025
Statutory audits: loans and provisions, inventory reconciliation, financial statements review.
Education
MSc Financial Engineering
Publications
Blockchain perceptions in auditing`;

test('CV similarity favours jobs in the same domain', () => {
  const { buildProfile, buildCorpus, scoreJob } = require('../src/match');
  const p = { ...buildProfile(FIN_CV), locations: [] };
  assert.ok(Object.keys(p.cvTerms).length > 10 && !('blockchain' in p.cvTerms), 'only professional sections');
  const jobs = [
    { title: 'Structured Products Analyst', description: 'Review structured product term sheets: barriers, strikes, maturities, payoff. SEC filings. Data quality.', location: 'Dhaka' },
    { title: 'Research Scientist', description: 'Molecular virology lab research, protein synthesis, cell culture, sequencing.', location: 'Oxford' },
    ...Array.from({ length: 8 }, (_, i) => ({ title: `Filler ${i}`, description: 'team work office general duties communication', location: 'London' })),
  ];
  const corpus = buildCorpus(jobs);
  const [fin, bio] = jobs.map((j) => scoreJob(p, j, corpus));
  assert.ok(fin.score > bio.score + 10, `fin ${fin.score} vs bio ${bio.score}`);
  assert.ok(bio.reasons.notes.includes('Weak CV fit'));
});

test('sales titles are not accounting jobs unless the profile is in sales', () => {
  const { scoreJob } = require('../src/match');
  const p = { skills: ['Accounting'], years: 3, roles: ['Accountant'], locations: [] };
  const s = (title, prof = p) => scoreJob(prof, { title, description: 'Accounting knowledge helps.', location: '' });
  assert.ok(s('Account Executive').score < s('Accounts Assistant').score - 10);
  assert.ok(s('Account Executive').reasons.notes.includes('Sales role'));
  assert.ok(!s('Account Executive', { ...p, skills: ['Sales'] }).reasons.notes.includes('Sales role'));
});

test('role suggestions come from what the CV shows, not only past titles', () => {
  const { suggestRoles } = require('../src/match');
  const r = suggestRoles(FIN_CV);
  assert.ok(r.includes('Financial Analyst') && r.includes('Internal Auditor'), r.join(', '));
  assert.ok(!r.includes('Software Engineer'));
});

test('skill mismatch scores low', () => {
  assert.ok(scoreJob(profile, job({ title: 'Accountant', description: 'IFRS, GAAP, Excel' })).score < 30);
});

test('search targets: home every time, relocation countries in turn', () => {
  const { searchTargets } = require('../src/sources');
  const p = { locations: ['Dhaka, Bangladesh'], relocate: ['UAE', 'Qatar'] };
  assert.deepEqual([0, 1, 2].map((t) => searchTargets(p, t).map((x) => x.location)),
    [['Dhaka, Bangladesh', 'UAE'], ['Dhaka, Bangladesh', 'Qatar'], ['Dhaka, Bangladesh', 'UAE']]);
  assert.deepEqual(searchTargets({ locations: [] }, 5), [{ location: '' }]);
});

test('company domain ignores job boards and bad urls', () => {
  const { companyDomain } = require('../src/sources');
  assert.equal(companyDomain('https://www.deloitte.com/ae/en.html'), 'deloitte.com');
  assert.equal(companyDomain('https://www.linkedin.com/company/deloitte'), null);
  assert.equal(companyDomain('https://ae.indeed.com/cmp/x'), null);
  assert.equal(companyDomain('javascript:alert(1)'), null);
  assert.equal(companyDomain(null), null);
});

test('Hunter name match must be the same company', () => {
  const { sameCompany } = require('../src/sources');
  assert.ok(sameCompany('Bangladesh Honda Pvt. Ltd.', 'Bangladesh Honda'));
  assert.ok(sameCompany('Deloitte', 'Deloitte Middle East'));
  assert.ok(!sameCompany('Global Solutions', 'Global Logistics'));
  assert.ok(!sameCompany('Acme', undefined));
});

test('feed shows a job posted on several sites once', () => {
  const db = require('../src/db').open(':memory:');
  const m = (score) => ({ score, eligible: true, reasons: { matched: [], missing: [], notes: [], blockers: [] } });
  const job = (id, source, company, score) => db.upsertJob({ id, source, title: 'Junior Data Analyst', company, location: 'Dubai', url: `https://x/${id}` }, m(score));
  job('a', 'Linkedin', 'Udrive', 54);
  job('b', 'Indeed', 'UDrive Rent a Car', 60);
  job('c', 'Indeed', 'Other Co', 54);
  const list = db.listJobs();
  assert.deepEqual(list.map((j) => j.id).sort(), ['b', 'c']);
  assert.deepEqual(list.find((j) => j.id === 'b').also, ['Linkedin']);
});

test('a later fetch with a fuller description replaces an empty one', () => {
  const db = require('../src/db').open(':memory:');
  const m = { score: 50, eligible: true, reasons: { matched: [], missing: [], notes: [], blockers: [] } };
  const job = (description) => db.upsertJob({ id: 'x', source: 'Linkedin', title: 'Auditor', url: 'https://x', description }, m);
  assert.equal(job(''), true);
  assert.equal(job('Audit, accounting and compliance.'), false);
  assert.equal(job(''), false);
  assert.equal(db.allJobs()[0].description, 'Audit, accounting and compliance.');
});

test('job type and salary are normalised across sources', () => {
  const { jobType, salaryText } = require('../src/sources');
  assert.equal(jobType('fulltime, contract'), 'fulltime,contract');
  assert.equal(jobType('FULLTIME'), 'fulltime');
  assert.equal(jobType('Part Time'), 'parttime');
  assert.equal(jobType('volunteer'), null);
  assert.equal(salaryText(25000, 40000, 'BDT', 'monthly'), 'BDT 25,000-40,000 / month');
  assert.equal(salaryText(0, 0, 'USD', 'year'), null);
  assert.equal(salaryText(80000, null, 'USD', 'YEAR'), 'USD 80,000 / year');
});

test('all-jobs feed, filters, sort and the application tracker', () => {
  const db = require('../src/db').open(':memory:');
  const r = { matched: [], missing: [], notes: [], blockers: [] };
  const add = (id, o, score, eligible = true) => db.upsertJob({ id, source: 'X', url: `https://x/${id}`, description: '', ...o }, { score, eligible, reasons: r });
  const today = new Date().toISOString().slice(0, 10);
  add('a', { title: 'Internal Auditor', company: 'Acme', location: 'Dhaka', posted_at: today, job_type: 'fulltime', salary: 'BDT 30,000 / month' }, 80);
  add('b', { title: 'Data Analyst', company: 'Beta', location: 'Dubai', remote: 1, posted_at: '2020-01-01', description: 'SQL and Excel' }, 60);
  add('c', { title: 'Nurse', company: 'Gamma', location: 'London', posted_at: today }, 10, false);
  const ids = (f) => db.listJobs(f).map((j) => j.id);
  assert.deepEqual(ids({ minScore: 50 }), ['a', 'b'], 'matches: eligible, score ≥ min, best first');
  assert.deepEqual(ids({ scope: 'all', sort: 'newest' }).sort(), ['a', 'b', 'c'], 'all jobs includes ineligible');
  assert.deepEqual(ids({ scope: 'all', q: 'excel' }), ['b'], 'keyword searches the description');
  assert.deepEqual(ids({ scope: 'all', days: 7 }).sort(), ['a', 'c']);
  assert.deepEqual(ids({ scope: 'all', workplace: 'remote' }), ['b']);
  assert.deepEqual(ids({ scope: 'all', jobType: 'fulltime', salaryOnly: true }), ['a']);
  assert.deepEqual(ids({ scope: 'all', location: 'dub' }), ['b']);
  db.setJobStage('b', 'interview');
  db.setJobStatus('a', 'saved');
  assert.deepEqual(db.myJobs().map((j) => [j.id, j.status, j.stage]).sort(), [['a', 'saved', null], ['b', 'applied', 'interview']]);
  db.setJobStatus('b', 'saved');
  assert.equal(db.getJob('b').stage, null, 'leaving applied clears the stage');
  assert.equal(db.getJob('b').description, 'SQL and Excel');
});

test('score explains itself and the dashboard stats add up', () => {
  const { scoreJob } = require('../src/match');
  const m = scoreJob({ skills: ['Audit'], years: 3, roles: ['Auditor'], locations: [] }, { title: 'Auditor', description: 'Audit. 2 years of experience.' });
  assert.deepEqual(Object.keys(m.reasons.parts).slice(0, 4), ['skills', 'title', 'experience', 'cv']);
  assert.equal(m.reasons.parts.title, 100);
  assert.equal(m.reasons.parts.cv, null, 'no corpus, no CV part');

  const db = require('../src/db').open(':memory:');
  const r = (notes = []) => ({ matched: [], missing: [], notes, blockers: [] });
  db.upsertJob({ id: 'a', source: 'X', title: 'A', url: 'https://x/a' }, { score: 80, eligible: true, reasons: r(['Strong CV fit']) });
  db.upsertJob({ id: 'b', source: 'X', title: 'B', url: 'https://x/b' }, { score: 40, eligible: true, reasons: r() });
  db.upsertJob({ id: 'c', source: 'X', title: 'C', url: 'https://x/c' }, { score: 90, eligible: false, reasons: r() });
  db.setJobStage('a', 'interview');
  assert.deepEqual(db.stats(50), { matches: 1, newToday: 1, strong: 1, total: 3, saved: 0, applied: 0, interview: 1, offer: 0 });
});

test('review queue, stage timestamps', () => {
  const db = require('../src/db').open(':memory:');
  const r = { matched: [], missing: [], notes: [], blockers: [] };
  for (const [id, score] of [['a', 90], ['b', 70], ['c', 60]]) db.upsertJob({ id, source: 'X', title: id, url: `https://x/${id}` }, { score, eligible: true, reasons: r });
  const queue = () => db.listJobs({ minScore: 50, unreviewed: true }).map((j) => j.id);
  assert.deepEqual(queue(), ['a', 'b', 'c']);
  db.markReviewed('a');
  db.setJobStatus('b', 'saved');
  assert.deepEqual(queue(), ['c'], 'reviewed and saved jobs leave the queue');
  db.setJobStage('c', 'applied');
  assert.ok(db.getJob('c').stage_at, 'stage changes are timestamped');
  assert.ok(db.myJobs().every((j) => 'stage_at' in j));
});

test('briefing and insights from local data', () => {
  const { briefing, insights, parseSalary } = require('../src/insights');
  assert.deepEqual(parseSalary('BDT 30,000-50,000 / month'), { currency: 'BDT', lo: 30000, hi: 50000, period: 'month' });
  assert.deepEqual(parseSalary('USD 80,000 / year'), { currency: 'USD', lo: 80000, hi: 80000, period: 'year' });
  assert.equal(parseSalary('Competitive'), null);

  const now = Date.parse('2026-10-26T12:00:00Z');
  const job = (id, o) => ({ id, title: id, company: 'C', source: 'Bdjobs', score: 70, found_at: '2026-10-26 10:00:00', status: 'new',
    reasons: { matched: ['Audit'], missing: ['Excel'], notes: [], blockers: [] }, ...o });
  const matches = [
    job('fresh', { score: 88, reasons: { matched: ['Audit', 'SQL'], missing: ['Excel'], notes: ['Strong CV fit'], blockers: [] }, salary: 'BDT 30,000-50,000 / month' }),
    job('old', { found_at: '2026-10-20 10:00:00', salary: 'BDT 40,000 / month' }),
  ];
  const mine = [
    { id: 'p', title: 'P', status: 'applied', stage: null, stage_at: '2026-10-15 09:00:00', found_at: '2026-10-14 09:00:00' },
    { id: 'q', title: 'Q', status: 'applied', stage: 'interview', stage_at: '2026-10-25 09:00:00', found_at: '2026-10-20 09:00:00' },
    { id: 'r', title: 'R', status: 'applied', stage: 'applied', stage_at: '2026-10-24 09:00:00', found_at: '2026-10-20 09:00:00' },
  ];
  const b = briefing({ matches, mine, queue: 5, lastSeen: '2026-10-25T00:00:00Z', now });
  assert.equal(b.newSince, 1);
  assert.deepEqual(b.followUps.map((j) => [j.id, j.days]), [['p', 11]], 'applied 7+ days ago with no reply');
  assert.deepEqual(b.interviews.map((j) => j.id), ['q']);
  assert.deepEqual(b.freshFits.map((j) => j.id), ['fresh']);
  assert.equal(b.toReview, 5);

  const ins = insights(matches, now);
  assert.deepEqual(ins.skills[0], { skill: 'Audit', n: 2, have: true });
  assert.ok(ins.skills.some((s) => s.skill === 'Excel' && !s.have && s.n === 2));
  assert.deepEqual(ins.salaries[0], { currency: 'BDT', period: 'month', n: 2, min: 30000, max: 50000, median: 40000 });
  assert.equal(ins.perDay.length, 14);
  assert.equal(ins.perDay.at(-1).n, 1);
  assert.deepEqual(ins.sources, [{ source: 'Bdjobs', n: 2 }]);
});

test('name from the CV header; review undo restores the job', () => {
  const { buildProfile } = require('../src/match');
  assert.equal(buildProfile('Yousuf Hossain Shafeen\nData Analyst at WSD\nProfessional Experience').name, 'Yousuf Hossain Shafeen');
  assert.equal(buildProfile('CURRICULUM VITAE 2026\nstuff').name, '');
  const db = require('../src/db').open(':memory:');
  db.upsertJob({ id: 'a', source: 'X', title: 'A', url: 'https://x/a' }, { score: 80, eligible: true, reasons: { matched: [], missing: [], notes: [], blockers: [] } });
  db.setJobStatus('a', 'saved');
  db.undoReview('a');
  const j = db.getJob('a');
  assert.deepEqual([j.status, j.reviewed, j.stage], ['new', 0, null]);
});

test('scoring v2: nine metrics, missing evidence is left out, not zero', () => {
  const { scoreJob, METRICS } = require('../src/match');
  assert.deepEqual(METRICS, ['skills', 'title', 'experience', 'cv', 'edge', 'seniority', 'education', 'pay', 'freshness']);
  const p = { skills: ['Audit', 'Accounting', 'Compliance'], years: 3, roles: ['Auditor'], locations: [], education: 2 };
  const m = scoreJob(p, { title: 'Auditor', description: 'Audit, accounting and compliance.' });
  assert.deepEqual(Object.keys(m.reasons.parts), METRICS);
  for (const k of ['cv', 'edge', 'pay', 'freshness', 'education', 'experience']) assert.equal(m.reasons.parts[k], null, `${k} has no evidence here`);
  assert.equal(m.score, 100, 'perfect on every metric that has evidence');
});

test('preferred skills count half; experience is graded', () => {
  const { scoreJob } = require('../src/match');
  const p = { skills: ['Audit'], years: 3, roles: ['Auditor'], locations: [] };
  const req = scoreJob(p, { title: 'Auditor', description: 'Requirements: Audit, Excel, SQL.' }).reasons.parts.skills;
  const pref = scoreJob(p, { title: 'Auditor', description: 'Requirements: Audit.\nNice to have: Excel, SQL.' }).reasons.parts.skills;
  assert.ok(pref > req, `missing only nice-to-haves (${pref}) beats missing requirements (${req})`);
  const exp = (d) => scoreJob(p, { title: 'Auditor', description: d }).reasons.parts.experience;
  assert.equal(exp('3 years of experience in audit'), 100);
  assert.equal(exp('4 years of experience in audit'), 60);
});

test('seniority, education, pay and freshness', () => {
  const { scoreJob } = require('../src/match');
  const now = Date.parse('2026-10-26T12:00:00Z');
  const p = { skills: ['Audit'], years: 3, roles: ['Auditor'], locations: [], education: 2, expectedSalary: { amount: 40000, currency: 'BDT', period: 'month' } };
  const s = (o) => scoreJob(p, { title: 'Auditor', description: 'Audit.', ...o }, null, now);
  assert.equal(s({ title: 'Auditor' }).reasons.parts.seniority, 100);
  assert.ok(s({ title: 'Head of Audit' }).reasons.parts.seniority < 20);
  assert.ok(s({ title: 'Senior Auditor' }).reasons.parts.seniority < 100);
  assert.equal(s({ description: "Audit. Bachelor's degree in accounting." }).reasons.parts.education, 100);
  const masters = s({ description: "Audit. Master's degree required." });
  assert.equal(masters.reasons.parts.education, 40);
  assert.ok(masters.reasons.notes.some((n) => /master/i.test(n)));
  assert.equal(s({ salary: 'BDT 30,000-50,000 / month' }).reasons.parts.pay, 100);
  assert.equal(s({ salary: 'BDT 20,000 / month' }).reasons.parts.pay, 50);
  assert.equal(s({ salary: 'BDT 480,000 / year' }).reasons.parts.pay, 100, 'yearly converts to monthly');
  assert.equal(s({ salary: 'USD 3,000 / month' }).reasons.parts.pay, null, 'no FX: other currencies are no evidence');
  assert.equal(s({ posted_at: '2026-10-26' }).reasons.parts.freshness, 100);
  assert.ok(s({ posted_at: '2026-09-20' }).reasons.parts.freshness <= 30);
});

test('competitive signals: rare-skill edge and pay vs market', () => {
  const { scoreJob, buildCorpus } = require('../src/match');
  const p = { skills: ['Accounting', 'Structured Products'], years: 3, roles: ['Analyst'], locations: [] };
  const filler = Array.from({ length: 30 }, (_, i) => ({ title: `Accountant ${i}`, description: 'Accounting and Excel work.', salary: 'BDT 30,000 / month' }));
  const rare = { title: 'Analyst', description: 'Structured Products and Excel.', salary: 'BDT 45,000 / month' };
  const common = { title: 'Analyst', description: 'Accounting and Excel.', salary: 'BDT 30,000 / month' };
  const corpus = buildCorpus([...filler, rare, common]);
  const r = scoreJob(p, rare, corpus), c = scoreJob(p, common, corpus);
  assert.ok(r.reasons.parts.edge > c.reasons.parts.edge, `rare ${r.reasons.parts.edge} vs common ${c.reasons.parts.edge}`);
  assert.ok(r.reasons.notes.some((n) => /rare skill/i.test(n)));
  assert.ok(r.reasons.notes.some((n) => /above market/i.test(n)), r.reasons.notes.join('; '));
});

test('calibration learns from decisions and is measured on held-out data', () => {
  const { calibrate, PRIOR_WEIGHTS } = require('../src/match');
  assert.equal(calibrate([]).active, false);
  // Synthetic user who decides almost only on pay: learned weights should find that.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const samples = Array.from({ length: 120 }, (_, i) => {
    const parts = { skills: rnd() * 100, title: rnd() * 100, experience: 100, cv: rnd() * 100, edge: rnd() * 100, seniority: 100, education: null, pay: rnd() * 100, freshness: rnd() * 100 };
    return { id: `j${i}`, parts, label: parts.pay > 55 ? 1 : 0 };
  });
  const c = calibrate(samples);
  assert.equal(c.active, true);
  assert.ok(c.weights.pay > PRIOR_WEIGHTS.pay * 2, `pay weight ${c.weights.pay}`);
  assert.ok(c.aucLearned > c.aucPrior, `held-out AUC learned ${c.aucLearned} vs prior ${c.aucPrior}`);
  assert.ok(Math.abs(Object.values(c.weights).reduce((a, b) => a + b, 0) - 100) < 0.5);
});

test('decisions become calibration labels', () => {
  const db = require('../src/db').open(':memory:');
  const r = { matched: [], missing: [], notes: [], blockers: [], parts: { skills: 80 } };
  for (const id of ['saved', 'applied', 'hidden', 'passed', 'untouched']) db.upsertJob({ id, source: 'X', title: id, url: `https://x/${id}` }, { score: 60, eligible: true, reasons: r });
  db.setJobStatus('saved', 'saved');
  db.setJobStage('applied', 'interview');
  db.setJobStatus('hidden', 'hidden');
  db.markReviewed('passed');
  assert.deepEqual(db.decisions().map((d) => [d.id, d.label]).sort(), [['applied', 1], ['hidden', 0], ['passed', 0], ['saved', 1]]);
});

test('education level read from the CV', () => {
  const { buildProfile } = require('../src/match');
  assert.equal(buildProfile('Jane Doe\nEducation\nBachelor of Business Administration\nSkills\nAudit').education, 2);
  assert.equal(buildProfile('Jane Doe\nEducation\nMSc in Finance\nBBA').education, 3);
  assert.equal(buildProfile('Jane Doe\nExperience\nClerk').education, null);
  // A referee's "PhD Candidate" is not the candidate's degree: only the Education section counts.
  assert.equal(buildProfile('Jane Doe\nEducation\nMSc in Finance\nBBA\nReferences\nDr. Smith, PhD Candidate').education, 3);
});

test('JSearch via OpenWebNinja: paced, rotated, country-coded, mapped', async () => {
  const sources = require('../src/sources');
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, key: opts.headers['X-API-Key'] });
    return { ok: true, json: async () => ({ status: 'OK', data: { jobs: [{ job_id: 'x1', job_title: 'Accountant', employer_name: 'Nazrul Group', job_city: null,
      job_country: 'BD', job_is_remote: false, job_apply_link: 'https://jobs.example/x1', job_description: 'IFRS', job_posted_at_datetime_utc: '2026-10-20T00:00:00.000Z',
      job_employment_type: 'Full-time', employer_website: 'https://nazrul.example' }] } }) };
  };
  try {
    const p = { roles: ['Accountant'], skills: [], locations: ['Dhaka, Bangladesh'], relocate: ['UAE'] };
    const off = await sources.SOURCES.jsearch(['Accountant'], p, { jsearchKey: 'ak_test' }, 1);
    assert.equal(off.length, 0);
    assert.equal(off.note, 'next search in 90 min', 'paced: no call between runs');
    assert.equal(calls.length, 0);
    const jobs = await sources.SOURCES.jsearch(['Accountant'], p, { jsearchKey: 'ak_test' }, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, 'ak_test');
    assert.ok(calls[0].url.startsWith('https://api.openwebninja.com/jsearch/search-v2?') && calls[0].url.includes('country=bd') && calls[0].url.includes('date_posted=week'), calls[0].url);
    assert.equal(jobs[0].location, 'Bangladesh', 'country code expanded so location rules match');
    assert.equal(sources.jobType(jobs[0].job_type), 'fulltime');
    assert.equal(jobs[0].company_url, 'https://nazrul.example');
    await sources.SOURCES.jsearch(['Accountant'], p, { jsearchKey: 'ak_test' }, 4);
    assert.ok(calls[1].url.includes('country=ae'), 'next run rotates to the relocation country');
  } finally { global.fetch = realFetch; }
});

test('pay converts other currencies at daily rates', () => {
  const { scoreJob, buildCorpus } = require('../src/match');
  const { parseRates } = require('../src/sources');
  const fx = parseRates({ date: '2026-10-25', usd: { usd: 1, bdt: 123.87, aed: 3.6725, bad: -1, worse: 'x' } });
  assert.deepEqual(Object.keys(fx.rates).sort(), ['aed', 'bdt', 'usd'], 'only finite positive rates are kept');
  const p = { skills: ['Audit'], years: 3, roles: ['Auditor'], locations: [], expectedSalary: { amount: 40000, currency: 'BDT', period: 'month' } };
  const corpus = { ...buildCorpus([]), fx };
  const dubai = scoreJob(p, { title: 'Auditor', description: 'Audit.', salary: 'AED 4,000 / month' }, corpus);
  assert.equal(dubai.reasons.parts.pay, 100);
  assert.ok(dubai.reasons.notes.includes('≈ BDT 134,916/month'), dubai.reasons.notes.join('; '));
  const low = scoreJob(p, { title: 'Auditor', description: 'Audit.', salary: 'USD 200 / month' }, corpus);
  assert.equal(low.reasons.parts.pay, 62);
  assert.equal(scoreJob(p, { title: 'Auditor', description: 'Audit.', salary: 'XYZ 9 / month' }, corpus).reasons.parts.pay, null, 'unknown currency: no evidence');
});

test('Reed: UK only, paced, full details, applicant counts', async () => {
  const sources = require('../src/sources');
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    const body = url.includes('/search?')
      ? { totalResults: 1, results: [{ jobId: 57400, jobTitle: 'Internal Auditor', employerName: 'Cygnet', locationName: 'ME194AE', applications: 4 }] }
      : { jobId: 57400, jobTitle: 'Internal Auditor', employerName: 'Cygnet', locationName: 'ME194AE', minimumSalary: 26300, maximumSalary: 26300, currency: 'GBP',
        salaryType: 'per annum', datePosted: '29/09/2026', jobUrl: 'https://www.reed.co.uk/jobs/internal-auditor/57400', contractType: 'Permanent', fullTime: true,
        partTime: false, jobDescription: '<p>Audit &amp; compliance</p>', applicationCount: 0 }; // real API: always 0 here
    return { ok: true, json: async () => body };
  };
  try {
    const uk = { roles: ['Internal Auditor'], skills: [], locations: ['Dhaka, Bangladesh'], relocate: ['UK'] };
    const noUk = await sources.SOURCES.reed(['Internal Auditor'], { ...uk, relocate: ['UAE'] }, { reedKey: 'k' }, 2);
    assert.equal(noUk.note, 'UK not in your locations');
    assert.equal((await sources.SOURCES.reed(['Internal Auditor'], uk, { reedKey: 'k' }, 0)).note, 'next search in 60 min');
    assert.equal(calls.length, 0);
    const jobs = await sources.SOURCES.reed(['Internal Auditor'], uk, { reedKey: 'k' }, 2);
    assert.equal(calls[0].auth, `Basic ${Buffer.from('k:').toString('base64')}`);
    assert.equal(calls.length, 2, 'one search + one details call');
    const j = jobs[0];
    assert.deepEqual([j.id, j.location, j.salary, j.posted_at, j.applicants, j.description],
      ['reed:57400', 'ME194AE, United Kingdom', 'GBP 26,300 / year', '2026-09-29', 4, 'Audit & compliance']);
    assert.equal(sources.jobType(j.job_type), 'fulltime');
  } finally { global.fetch = realFetch; }
  const { scoreJob } = require('../src/match');
  const p = { skills: ['Audit'], years: 3, roles: ['Auditor'], locations: [] };
  assert.ok(scoreJob(p, { title: 'Auditor', description: 'Audit', applicants: 4 }).reasons.notes.includes('Few applicants (4)'));
  assert.ok(scoreJob(p, { title: 'Auditor', description: 'Audit', applicants: 0 }).reasons.notes.includes('No applicants yet'));
  assert.ok(scoreJob(p, { title: 'Auditor', description: 'Audit', applicants: 120 }).reasons.notes.includes('120 applicants already'));
});

test('source files contain no stray control characters', () => {
  // Generated edits once turned regex `\b` into backspace (0x08), silently breaking matches.
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..');
  const files = ['src', 'src/ui', 'src/web'].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => /\.(js|py|html|css)$/.test(f)).map((f) => path.join(d, f)));
  for (const f of files) {
    const bad = [...fs.readFileSync(path.join(root, f), 'utf8')].filter((c) => { const n = c.charCodeAt(0); return n < 32 && n !== 9 && n !== 10 && n !== 13; });
    assert.equal(bad.length, 0, `${f} has control characters`);
  }
  assert.equal(require('../src/sources').jobType('Temp'), 'temporary');
  // Renderer scripts are never required by tests; compile them so a syntax error fails here, not in the app.
  const vm = require('vm');
  for (const f of files.filter((f) => f.endsWith('.js'))) assert.doesNotThrow(() => new vm.Script(`(function (exports, require, module, __filename, __dirname) {
${fs.readFileSync(path.join(root, f), 'utf8')}
})`, { filename: f }), `${f} does not parse`);
});

// Shaped like a FlowCV PDF's extracted text: columns interleave, so dates and locations land between bullets.
const FLOW_CV = `Jane Rahman
Data Analyst at Acme Docs
jane@example.com
(+880) 1886000000
30, Some Street Wari
27th February 2003
LinkedIn
Profile
I enjoy turning data into decisions.
As a CFA aspirant, I keep learning.
Professional Experience
Acme Docs
Data Analyst
•Analyze SEC structured product
filings to ensure accuracy.
10/2025 – Present
Dhaka, Bangladesh
•Clean datasets.
Grant Thornton Bangladesh (Audit Firm)
Audit Assistant
My core responsibilities include preparing audit proposals, analyzing
financial statements.
01/2025 – 09/2025
Dhaka, Bangladesh
Independent University, Bangladesh
Research Assistant
•Perform literature reviews.
05/2022 – 12/2024
Dhaka, Bangladesh
Education
World Quant University
MSc in Financial Engineering
Running Score: 96%
01/2026 – Present
Washington D.C, USA
Certificate
Courses
Business Research Methodology
Cambridge University Edx Online
2024
Exercising Leadership
Harvard Business School Online
2022
Skills
Audit, Accounting, SQL`;

test('CV importer: personal details, sections, entries from FlowCV-style text', () => {
  const { parseCvText } = require('../src/cvdoc');
  const cv = parseCvText(FLOW_CV);
  assert.deepEqual([cv.personal.name, cv.personal.title, cv.personal.email, cv.personal.phone, cv.personal.location],
    ['Jane Rahman', 'Data Analyst at Acme Docs', 'jane@example.com', '(+880) 1886000000', '30, Some Street Wari']);
  assert.ok(!JSON.stringify(cv).includes('February 2003'), 'date of birth is not imported');
  assert.deepEqual(cv.sections.map((s) => s.type), ['profile', 'experience', 'education', 'courses', 'skills']);
  assert.equal(cv.sections[0].text, 'I enjoy turning data into decisions.\nAs a CFA aspirant, I keep learning.');
  const [a, b, c] = cv.sections[1].items;
  assert.deepEqual([a.title, a.subtitle, a.start, a.end, a.location], ['Data Analyst', 'Acme Docs', '10/2025', 'Present', 'Dhaka, Bangladesh'], 'role first, employer second');
  assert.equal(a.description, '• Analyze SEC structured product filings to ensure accuracy.\n• Clean datasets.');
  assert.deepEqual([b.title, b.subtitle, b.start, b.end], ['Audit Assistant', 'Grant Thornton Bangladesh (Audit Firm)', '01/2025', '09/2025']);
  assert.equal(b.description, 'My core responsibilities include preparing audit proposals, analyzing financial statements.');
  assert.deepEqual([c.title, c.subtitle, c.location], ['Research Assistant', 'Independent University, Bangladesh', 'Dhaka, Bangladesh'], 'an employer with a comma is not a location');
  const edu = cv.sections[2].items[0];
  assert.deepEqual([edu.title, edu.subtitle, edu.description, edu.location], ['MSc in Financial Engineering', 'World Quant University', 'Running Score: 96%', 'Washington D.C, USA']);
  assert.deepEqual(cv.sections[3].items.map((e) => [e.title, e.subtitle, e.start]), [['Business Research Methodology', 'Cambridge University Edx Online', '2024'], ['Exercising Leadership', 'Harvard Business School Online', '2022']]);
  assert.deepEqual(cv.sections[4].items.map((t) => t.name), ['Audit', 'Accounting', 'SQL']);
});

test('documents: create, list by kind, update, delete', () => {
  const db = require('../src/db').open(':memory:');
  db.saveDoc({ id: 'cv1', kind: 'cv', name: 'Audit CV', data: { personal: { name: 'Jane' } } });
  db.saveDoc({ id: 'l1', kind: 'letter', name: 'Letter to Acme', data: { blocks: [] } });
  assert.deepEqual(db.listDocs('cv').map((d) => d.name), ['Audit CV']);
  db.saveDoc({ id: 'cv1', kind: 'cv', name: 'Audit CV v2', data: { personal: { name: 'Jane R' } } });
  assert.equal(db.getDoc('cv1').data.personal.name, 'Jane R');
  assert.equal(db.listDocs('cv').length, 1);
  db.deleteDoc('cv1');
  assert.equal(db.getDoc('cv1'), undefined);
  assert.throws(() => db.saveDoc({ id: 'x', kind: 'resume', name: 'n', data: {} }), /CHECK/);
});

test('contacts from description', () => {
  const c = contactsFromText('Apply to jane.smith@acme.com or see linkedin.com/in/jane-smith-123 / noreply@x.com');
  assert.deepEqual(c.map((x) => x.email || x.profile_url), ['jane.smith@acme.com', 'https://www.linkedin.com/in/jane-smith-123']);
});

test('web: corpus survives the JSON round trip the online fetcher uses, so scores match the desktop', () => {
  const { buildCorpus, corpusToJson, corpusFromJson, scoreJob, buildProfile } = require('../src/match');
  const jobs = Array.from({ length: 12 }, (_, i) => ({ title: i % 2 ? 'Data Analyst' : 'Internal Auditor', company: `Co${i}`, location: 'Dhaka, Bangladesh',
    description: `SQL Excel Power BI audit reporting ${i % 3 ? 'reconciliation' : 'forecasting'}`, salary: `BDT ${40000 + i * 1000} / month` }));
  const p = { ...require('../src/match').DEFAULT_PROFILE, ...buildProfile('Data Analyst\nProfessional Experience\nData Analyst at WSD 2022 - Present\nSQL, Excel, Power BI, audit, reconciliation'), locations: ['Dhaka, Bangladesh'] };
  const direct = buildCorpus(jobs), viaJson = corpusFromJson(JSON.parse(JSON.stringify(corpusToJson(direct))));
  const job = { ...jobs[1], id: 't:1', url: 'https://x', posted_at: '' };
  assert.equal(scoreJob(p, job, viaJson).score, scoreJob(p, job, direct).score);
  assert.deepEqual(require('../src/insights').jobFilters({ scope: 'x', days: 5, q: ' sql ' }), { scope: 'matches', minScore: 0, q: 'sql', location: '', days: 0, workplace: '', jobType: '', salaryOnly: false, sort: 'match' });
});
