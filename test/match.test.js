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
  assert.deepEqual(p.roles, ['Data Analyst', 'Audit Assistant']);
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

test('contacts from description', () => {
  const c = contactsFromText('Apply to jane.smith@acme.com or see linkedin.com/in/jane-smith-123 / noreply@x.com');
  assert.deepEqual(c.map((x) => x.email || x.profile_url), ['jane.smith@acme.com', 'https://www.linkedin.com/in/jane-smith-123']);
});
