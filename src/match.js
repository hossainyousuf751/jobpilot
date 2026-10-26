// CV → profile extraction and job scoring. Pure functions, no Electron.
const { parseSalary } = require('./insights');

const SKILLS = [
  // languages & runtimes
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'C++', 'Golang', 'Rust', 'Ruby', 'PHP', 'Kotlin', 'Swift',
  'Scala', 'Perl', 'Bash', 'PowerShell', 'SQL', 'NoSQL', 'VBA', 'MATLAB', 'Dart', 'Elixir', 'Haskell',
  // web & frameworks
  'React', 'Angular', 'Vue', 'Next.js', 'Svelte', 'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI',
  'Spring', 'Spring Boot', '.NET', 'ASP.NET', 'Rails', 'Laravel', 'HTML', 'CSS', 'Sass', 'Tailwind', 'Redux',
  'GraphQL', 'REST', 'gRPC', 'WebSockets', 'jQuery', 'Bootstrap', 'Flutter', 'React Native', 'Electron',
  // data & ML
  'PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'DynamoDB',
  'Snowflake', 'BigQuery', 'Redshift', 'Databricks', 'Spark', 'Hadoop', 'Kafka', 'Airflow', 'dbt', 'ETL',
  'Pandas', 'NumPy', 'scikit-learn', 'TensorFlow', 'PyTorch', 'Machine Learning', 'Deep Learning', 'NLP',
  'Computer Vision', 'LLM', 'Data Analysis', 'Data Engineering', 'Data Modeling', 'Statistics', 'Power BI',
  'Tableau', 'Looker', 'Excel', 'Google Sheets', 'SSIS', 'SSRS',
  // cloud & ops
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions',
  'GitLab CI', 'CI/CD', 'Linux', 'Nginx', 'Microservices', 'Serverless', 'Prometheus', 'Grafana', 'Datadog',
  'Git', 'Agile', 'Scrum', 'Kanban', 'Jira', 'Confluence', 'DevOps', 'SRE', 'Networking', 'Active Directory',
  // quality & security
  'Unit Testing', 'Jest', 'Cypress', 'Playwright', 'Selenium', 'JUnit', 'pytest', 'QA', 'Test Automation',
  'OWASP', 'Penetration Testing', 'SIEM', 'IAM', 'ISO 27001', 'SOC 2', 'GDPR',
  // enterprise platforms
  'Salesforce', 'Apex', 'SAP', 'ServiceNow', 'Dynamics 365', 'SharePoint', 'Workday', 'HubSpot',
  // docs, publishing & finance
  'XML', 'XSLT', 'XBRL', 'iXBRL', 'InDesign', 'Adobe Acrobat', 'Photoshop', 'Illustrator', 'Figma', 'Sketch',
  'Typesetting', 'Proofreading', 'Copywriting', 'Technical Writing', 'Financial Reporting', 'IFRS', 'GAAP',
  'Accounting', 'Financial Modeling', 'Bloomberg', 'Compliance', 'Risk Management', 'Audit', 'KYC', 'AML',
  'Financial Analysis', 'Financial Statements', 'Financial Engineering', 'Investment Analysis', 'Equity Research',
  'Valuation', 'Derivatives', 'Structured Products', 'Fixed Income', 'Capital Markets', 'Portfolio Management',
  'Quantitative Analysis', 'Econometrics', 'Reconciliation', 'Budgeting', 'Forecasting', 'Tally', 'QuickBooks',
  'SEC', 'CFA', 'ACCA', 'CPA', 'Data Analytics', 'Data Cleaning', 'Data Quality', 'Data Visualization',
  'Blockchain', 'Research', 'Literature Review', 'Policy Analysis', 'ESG', 'Climate Finance',
  // product, people & business
  'Project Management', 'Product Management', 'Stakeholder Management', 'Business Analysis', 'UX', 'UI Design',
  'User Research', 'PMP', 'PRINCE2', 'ITIL', 'Six Sigma', 'Customer Success', 'Account Management',
  'Sales', 'Marketing', 'SEO', 'CRM', 'Recruitment', 'Operations', 'Team Leadership', 'Mentoring',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
function skillRe(s) {
  // "Spring 2023" is a semester, not the framework.
  const tail = s === 'Spring' ? '(?!\\s+(?:19|20)\\d{2})' : '';
  if (!reCache.has(s)) reCache.set(s, new RegExp(`(?<![\\w+#])${esc(s)}(?![\\w+#])${tail}`, 'i'));
  return reCache.get(s);
}

function findSkills(text, list = SKILLS) {
  return list.filter((s) => skillRe(s).test(text));
}

const RANGE_RE = /\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*(?:[A-Za-z]{3,9}\.?\s+|\d{1,2}\/)?((?:19|20)\d{2}|present|current|now)\b/gi;
const EXP_HEAD = /^\s*(?:professional |work |relevant )?(?:experience|employment(?: history)?|work history)\s*$/im;
const NEXT_HEAD = /^\s*(?:education|academic.*|projects?|skills|certifications?|courses|publications|references|awards|achievements.*|languages|extended learning|volunteer.*|interests|training)\s*$/im;

// Only the Experience section, so education dates don't count as work.
function experienceSection(text) {
  const m = EXP_HEAD.exec(text);
  if (!m) return text;
  const rest = text.slice(m.index + m[0].length);
  const end = NEXT_HEAD.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

// ponytail: year precision, overlapping ranges merged; user can correct years in Profile.
function cvYears(text, now = new Date().getFullYear()) {
  const stated = [...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs)\b/gi)].map((m) => +m[1]).filter((n) => n <= 40);
  if (stated.length) return Math.max(...stated);
  const ranges = [...experienceSection(text).matchAll(RANGE_RE)]
    .map((m) => [+m[1], /\d/.test(m[2]) ? +m[2] : now])
    .filter(([a, b]) => a <= b && b <= now)
    .sort((x, y) => x[0] - y[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of ranges) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

const ROLE_RE = /\b(engineer|developer|analyst|manager|designer|consultant|specialist|scientist|architect|lead|coordinator|administrator|officer|associate|executive|accountant|writer|editor|tester|assistant|auditor|researcher)\b/i;
const NOT_ROLE = /\b(diploma|degree|bachelor|master|msc|mba|bba|certificat\w*|course|university|school|college|program(?:me)?)\b/i;

function detectRoles(text) {
  const roles = [];
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.split(/\s[|@–—-]\s|\sat\s|\sand\s|,/)) {
      const p = part.trim();
      if (p.length >= 5 && p.length <= 50 && ROLE_RE.test(p) && !NOT_ROLE.test(p) && !roles.some((r) => r.toLowerCase() === p.toLowerCase())) roles.push(p);
    }
    if (roles.length >= 3) break;
  }
  return roles;
}

// Roles the CV's content qualifies you for, beyond past job titles. Evidence in the professional
// sections counts double. ponytail: hand-written rules; extend the list for other professions.
const ROLE_RULES = [
  ['Financial Analyst', /financial (?:analysis|statements?|modell?ing|reporting|engineering)|valuation|\bcfa\b|fp&a/gi],
  ['Internal Auditor', /\baudit\w*/gi],
  ['Accountant', /accounting|bookkeeping|reconciliation|\btally\b|quickbooks|ledger|ifrs|gaap/gi],
  ['Data Analyst', /data (?:analy\w*|cleaning|quality|processing|sets?)|datasets?|\bsql\b|power bi|tableau|python/gi],
  ['Risk Analyst', /\brisk\b|derivatives|structured products?|\bcredit\b|barriers?|payoff/gi],
  ['Compliance Analyst', /compliance|regulatory|\bkyc\b|\baml\b|sec filings?/gi],
  ['Investment Analyst', /investments?\b|portfolio|capital markets?|equity research|asset management|indices/gi],
  ['Research Analyst', /\bresearch\b|literature reviews?/gi],
  ['Business Analyst', /business analysis|requirements gathering|process mapping|stakeholder/gi],
  ['Project Coordinator', /project (?:plans?|management|documentation|coordination)|status reports/gi],
  ['Product Manager', /product management|roadmap|product vision|\bmvp\b/gi],
  ['Software Engineer', /software (?:engineer|develop)\w*|javascript|typescript|\bjava\b|react|node\.js/gi],
];
function suggestRoles(text) {
  const prof = professionalText(text);
  const count = (re, s) => (s.match(re) || []).length;
  return ROLE_RULES.map(([role, re]) => [role, 2 * count(re, prof) + count(re, text)])
    .filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([role]) => role);
}

// --- CV ↔ job text similarity (TF-IDF cosine), so the whole CV counts, not only listed skills.
const STOP = new Set(('the and for with from that this are was were you your our will have has had not but all any can may per into their they '
  + 'them its out over such than then there these those under upon very via who whom why how what when where which while also more most other some '
  + 'each both able about above after again against being below between during further here just once only same should through until well within '
  + 'would could including include includes using used use work working role job team teams company experience years year strong skills skill '
  + 'ability required requirements responsibilities candidate candidates position apply must etc new good excellent knowledge understanding '
  + 'support provide ensure related relevant across based assistant associate executive officer specialist coordinator '
  + 'intern trainee manager consultant representative clerk member graduate').split(' '));
// ponytail: suffix-strip + 8-char prefix as a stemmer; good enough for ranking, swap for a real stemmer if needed.
const stemWord = (w) => w.replace(/(ings|ing|ers|er|ies|es|s|ed|ly|ions|ion|ments|ment)$/, '').slice(0, 8);
const termsOf = (t) => (t.toLowerCase().match(/[a-z][a-z&]{2,}/g) || []).filter((w) => !STOP.has(w)).map(stemWord).filter((w) => w.length > 2);
const termCounts = (t) => { const m = new Map(); for (const w of termsOf(t)) m.set(w, (m.get(w) || 0) + 1); return m; };

// Experience and skills sections only: education, publications and references describe you, not the job you'd do.
const SECTION_HEAD = /^\s*(profile|summary|about me|professional summary|professional experience|work experience|experience|employment(?: history)?|skills|key skills|core competencies|education|academic.*|projects?|courses|publications|conferences?|references|achievements.*|certifications?|certificates?|extended learning|languages|interests|awards|volunteer.*|training)\s*$/i;
const KEEP_SECTION = /experience|employment|skills|competenc/i;
function professionalText(text) {
  let cur = null;
  const keep = [];
  for (const line of text.split(/\r?\n/)) {
    const h = SECTION_HEAD.exec(line);
    if (h) cur = h[1];
    else if (cur && KEEP_SECTION.test(cur)) keep.push(line);
  }
  return keep.length > 5 ? keep.join('\n') : text;
}

// Document frequencies over the stored jobs, place/company words that would only match on geography,
// and the market median pay per currency/period (for "pays above/below market").
function buildCorpus(jobs) {
  const df = new Map(), noise = new Set(), pay = new Map();
  for (const j of jobs) {
    for (const w of new Set(termsOf(`${j.title || ''} ${j.description || ''}`))) df.set(w, (df.get(w) || 0) + 1);
    for (const w of termsOf(`${j.location || ''} ${j.company || ''}`)) noise.add(w);
    const s = parseSalary(j.salary);
    if (s?.currency && s.period) pay.set(`${s.currency}/${s.period}`, [...(pay.get(`${s.currency}/${s.period}`) || []), (s.lo + s.hi) / 2]);
  }
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return { n: jobs.length, df, noise, payMedian: new Map([...pay].filter(([, xs]) => xs.length >= 5).map(([k, xs]) => [k, median(xs)])) };
}

function cvSimilarity(cvTerms, job, corpus) {
  const idf = (w) => Math.log((corpus.n + 1) / ((corpus.df.get(w) || 0) + 1));
  const vec = (entries) => {
    const v = new Map();
    let n = 0;
    for (const [w, c] of entries) { const x = (1 + Math.log(c)) * idf(w); v.set(w, x); n += x * x; }
    return { v, n: Math.sqrt(n) };
  };
  const cv = vec(Object.entries(cvTerms).filter(([w]) => corpus.df.has(w) && !corpus.noise.has(w)));
  const jv = vec(termCounts(`${job.title} ${job.title} ${job.description || ''}`)); // title counts double
  let dot = 0;
  for (const [w, x] of cv.v) if (jv.v.has(w)) dot += x * jv.v.get(w);
  return cv.n && jv.n ? dot / (cv.n * jv.n) : 0;
}

function buildProfile(text) {
  const titles = detectRoles(text);
  const suggestedRoles = suggestRoles(text);
  const roles = [...titles, ...suggestedRoles.filter((r) => !titles.some((t) => t.toLowerCase() === r.toLowerCase()))].slice(0, 5);
  // Term counts, not the CV text itself: enough for matching, less personal data stored.
  const cvTerms = Object.fromEntries([...termCounts(professionalText(text))].sort((a, b) => b[1] - a[1]).slice(0, 300));
  // CVs start with the person's name: 2-4 capitalised words, letters only.
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const name = /^(\p{Lu}[\p{L}'-]+)( \p{Lu}[\p{L}'-]+){1,3}$/u.test(first) && first !== first.toUpperCase() ? first : '';
  return { name, skills: findSkills(text), years: cvYears(text), education: cvEducation(text), roles, suggestedRoles, cvTerms };
}

// Degree levels: 1 diploma/school, 2 bachelor, 3 master, 4 doctorate.
const EDU = [[4, /\b(ph\.?d|doctorate|doctoral)\b/i], [3, /\b(master'?s|master of|msc|m\.sc|mba|postgraduate|post-graduate)\b/i],
  [2, /\b(bachelor'?s?|bba|bsc|b\.sc|b\.com|bcom|undergraduate|university degree)\b/i], [1, /\b(diploma|hsc|a-?levels?|high school|secondary school)\b/i]];
const EDU_NAME = { 1: 'a diploma', 2: "a bachelor's degree", 3: "a master's degree", 4: 'a doctorate' };
// The Education section only (referees' "PhD Candidate" must not count), or the whole CV if it has no such heading.
function educationText(text) {
  let cur = null;
  const keep = [];
  for (const line of text.split(/\r?\n/)) {
    const h = SECTION_HEAD.exec(line);
    if (h) cur = h[1];
    else if (cur && /^(education|academic)/i.test(cur)) keep.push(line);
  }
  return keep.length ? keep.join('\n') : text;
}
// ponytail: highest degree in the Education section, in-progress degrees included; the user corrects it in Profile.
function cvEducation(text) {
  const edu = educationText(text);
  const levels = EDU.filter(([, re]) => re.test(edu)).map(([l]) => l);
  return levels.length ? Math.max(...levels) : null;
}

// Minimum years a posting asks for, e.g. "3-5 years of experience" → 3.
function jobYears(text) {
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?(?:years?|yrs)(?:['’]s?)?\s+(?:of\s+)?(?:[\w-]+\s+){0,4}?experience/gi;
  const ns = [...text.matchAll(re)].map((m) => +m[1]).filter((n) => n > 0 && n <= 20);
  return ns.length ? Math.min(...ns) : null;
}

const SPONSOR_RE = /no (?:visa )?sponsorship|(?:not|unable to) (?:provide |offer )?sponsor|(?:us|u\.s\.|uk) citizens? only|must be a (?:us|u\.s\.) citizen|security clearance|nationals? only|\b(?:uae|saudi|qatari|kuwaiti|omani|bahraini|emirati) nationals?\b|emiratis? only|\b(?:emirati|saudi|qatari|omani)[sz]ation\b/i;
const SENIORITY_WORDS = /\b(senior|sr|junior|jr|lead|principal|staff|head|mid|level|i{1,3})\b/gi;
const words = (s) => s.toLowerCase().replace(SENIORITY_WORDS, ' ').split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1);
// ponytail: prefix stemming (audit~auditor, accounting~accountant, analyst~analysis); a real stemmer if it misfires.
const sameStem = (a, b) => {
  if (a === b) return true;
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n >= 5 && n >= Math.min(a.length, b.length) - 3;
};

// Job sites spell countries differently; each list is one country.
const COUNTRY_NAMES = [
  ['united arab emirates', 'uae', 'dubai', 'abu dhabi', 'sharjah'],
  ['united kingdom', 'uk', 'england', 'scotland', 'wales'],
  ['united states', 'usa', 'us'],
  ['saudi arabia', 'ksa', 'riyadh', 'jeddah'],
];
const placeNames = (place) => {
  const p = place.toLowerCase().trim();
  return COUNTRY_NAMES.find((names) => names.includes(p)) || [p];
};
const inPlace = (loc, place) => placeNames(place).some((n) => new RegExp(`(?<![a-z])${esc(n)}(?![a-z])`, 'i').test(loc));
const city = (l) => l.split(',')[0].trim();
const country = (l) => l.split(',').pop().trim();

// Pushes a blocker when the job is somewhere you can't work; returns true when it needs relocation.
function checkLocation(p, job, blockers) {
  const onsite = (p.locations || []).filter((l) => l.trim());
  const relocate = (p.relocate || []).filter((l) => l.trim());
  const regions = (p.remoteFrom || []).filter((l) => l.trim());
  const loc = job.location || '';
  if (!(onsite.length || relocate.length || regions.length) || !loc.trim() || /anywhere|worldwide|global/i.test(loc)) return false;
  if (onsite.some((l) => inPlace(loc, city(l)))) return false;
  if (job.remote && [...regions, ...onsite.map(country)].some((r) => inPlace(loc, r))) return false;
  if (relocate.some((c) => inPlace(loc, c))) return true;
  blockers.push(job.remote ? `Remote limited to ${loc}` : `On-site in ${loc}`);
  return false;
}

// Seniority/function words say little about the field: "Research Assistant" ≠ "Assistant Engineer".
const GENERIC_TITLE = new Set(['assistant', 'associate', 'executive', 'officer', 'specialist', 'coordinator', 'intern', 'trainee',
  'manager', 'consultant', 'representative', 'clerk', 'member', 'team', 'graduate']);

// ---- Scoring v2: nine explainable metrics (0-1 each, null = no evidence), combined with weights.
const METRICS = ['skills', 'title', 'experience', 'cv', 'edge', 'seniority', 'education', 'pay', 'freshness'];
// Priors until calibration has enough decisions. Freshness is low: nearly every fetched job is under a week old.
const PRIOR_WEIGHTS = { skills: 25, title: 20, experience: 12, cv: 13, edge: 9, seniority: 10, education: 4, pay: 5, freshness: 2 };

// Weighted mean over the metrics that have evidence; missing evidence neither helps nor hurts.
function combine(parts, weights = PRIOR_WEIGHTS) {
  let sum = 0, wsum = 0;
  for (const k of METRICS) if (parts[k] != null) { sum += weights[k] * parts[k]; wsum += weights[k]; }
  return wsum ? sum / wsum : 0;
}

// "Nice to have" sentences: skills only mentioned there count half.
const PREFERRED = /prefer|nice[ -]to[ -]have|\bplus\b|advantage|desirable|bonus|ideally/i;
const sentences = (text) => text.split(/\n|(?<=[.;!?])\s+/);

// Title level: 0 intern … 2 mid (no level word) … 5 head/director; your level from years.
function titleLevel(t) {
  if (/\b(head|director|vp|vice president|chief)\b/.test(t)) return 5;
  if (/\b(assistant|deputy) manager\b/.test(t)) return 3;
  if (/\b(manager|lead|principal)\b/.test(t)) return 4;
  if (/\b(senior|sr)\b/.test(t)) return 3;
  if (/\b(intern|internship|trainee)\b/.test(t)) return 0;
  if (/\b(junior|jr|graduate|entry|assistant)\b/.test(t)) return 1;
  return 2;
}
const yourLevel = (years) => (years < 1 ? 0 : years < 2 ? 1 : years < 5 ? 2 : years < 8 ? 3 : years < 12 ? 4 : 5);

const PER_MONTH = { month: 1, year: 1 / 12, week: 4.33, day: 22, hour: 176 };
const DAY = 864e5;
const parseTime = (s) => (!s ? NaN : /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? Date.parse(s) : Date.parse(`${s.replace(' ', 'T')}Z`));

// corpus (from buildCorpus) is optional: without it, CV similarity, skill edge and market pay are no evidence.
function scoreJob(p, job, corpus, now = Date.now(), weights = p.calibration?.active ? p.calibration.weights : PRIOR_WEIGHTS) {
  const title = job.title || '';
  const desc = job.description || '';
  const text = `${title}\n${desc}`;
  const blockers = [], notes = [];
  let penalty = 0;

  const extra = p.skills.filter((s) => !SKILLS.some((k) => k.toLowerCase() === s.toLowerCase()));
  const jobSkills = findSkills(text, [...SKILLS, ...extra]);
  const have = new Set(p.skills.map((s) => s.toLowerCase()));
  const matched = jobSkills.filter((s) => have.has(s.toLowerCase()));
  const required = sentences(text).filter((s) => !PREFERRED.test(s)).join('\n');
  const weightOf = (s) => (skillRe(s).test(required) ? 1 : 0.5);
  // Required skills you lack first: those are the gaps that matter.
  const missing = jobSkills.filter((s) => !have.has(s.toLowerCase())).sort((a, b) => weightOf(b) - weightOf(a));
  // Pad to 3 skills in the denominator: one generic shared skill shouldn't mean full coverage.
  const total = jobSkills.reduce((a, s) => a + weightOf(s), 0) + Math.max(0, 3 - jobSkills.length);
  const coverage = jobSkills.length ? matched.reduce((a, s) => a + weightOf(s), 0) / total : 0.3;

  const tw = words(title);
  const titleHit = Math.max(0, ...p.roles.map((r) => {
    const all = words(r), core = all.filter((w) => !GENERIC_TITLE.has(w));
    const rw = core.length ? core : all;
    return rw.length ? rw.filter((w) => tw.some((t) => sameStem(w, t))).length / rw.length : 0;
  }));
  // Nothing in the title relates to your roles: generic skill words alone shouldn't make it a match.
  if (titleHit === 0) penalty += 10;

  const need = jobYears(desc);
  if (need != null && need > p.years + 1) blockers.push(`Needs ${need}+ yrs (you have ${p.years})`);
  // Graded: one year short is 0.6, not a cliff; no stated requirement is no evidence.
  const experience = need == null ? null : need <= p.years ? 1 : Math.max(0, 1 - 0.4 * (need - p.years));

  const t = title.toLowerCase();
  if (/\b(director|vp|vice president|head of|chief)\b/.test(t) && p.years < 8) blockers.push('Executive-level role');
  const gap = titleLevel(t) - yourLevel(p.years);
  const seniority = Math.max(0, 1 - 0.35 * Math.abs(gap));
  if (gap >= 2) notes.push('Stretch role');
  else if (gap <= -2) notes.push('Below your level');

  // Education: the lowest degree a non-optional sentence asks for, against yours.
  const asked = EDU.filter(([, re]) => re.test(required)).map(([l]) => l);
  const needEdu = asked.length ? Math.min(...asked) : null;
  const education = needEdu == null || p.education == null ? null : p.education >= needEdu ? 1 : p.education === needEdu - 1 ? 0.4 : 0;
  if (education != null && education < 1) notes.push(`Asks for ${EDU_NAME[needEdu]}`);

  // Pay against your expectation (same currency only: no FX), and against the market median.
  const sal = parseSalary(job.salary);
  const exp = p.expectedSalary;
  // Other currencies are converted at daily rates (corpus.fx). ponytail: nominal rates, no cost-of-living adjustment.
  const rate = (c) => corpus?.fx?.rates?.[String(c).toLowerCase()];
  const toExp = sal && exp?.amount > 0 && (sal.currency === exp.currency ? 1 : rate(sal.currency) && rate(exp.currency) ? rate(exp.currency) / rate(sal.currency) : null);
  const pay = toExp && PER_MONTH[sal.period] && PER_MONTH[exp.period]
    ? Math.min(1, (sal.hi * PER_MONTH[sal.period] * toExp) / (exp.amount * PER_MONTH[exp.period])) : null;
  if (pay != null && sal.currency !== exp.currency) {
    notes.push(`≈ ${exp.currency} ${Math.round(sal.hi * PER_MONTH[sal.period] * toExp / PER_MONTH[exp.period]).toLocaleString('en-US')}/${exp.period}`);
  }
  const median = sal && corpus?.payMedian?.get(`${sal.currency}/${sal.period}`);
  if (median) {
    const diff = Math.round((100 * ((sal.lo + sal.hi) / 2 - median)) / median);
    if (diff >= 15) notes.push(`Pays ${diff}% above market`);
    else if (diff <= -15) notes.push(`Pays ${-diff}% below market`);
  }

  // Competition, where the source tells us (Reed): few applicants is an opening, many is a crowd.
  if (Number.isInteger(job.applicants)) {
    if (job.applicants === 0) notes.push('No applicants yet');
    else if (job.applicants <= 10) notes.push(`Few applicants (${job.applicants})`);
    else if (job.applicants >= 50) notes.push(`${job.applicants} applicants already`);
  }

  // Freshness: early applicants get read. 1 for 2 days, falling to 0.3 at 30 days.
  const age = (now - parseTime(job.posted_at)) / DAY;
  const freshness = Number.isNaN(age) ? null : age <= 2 ? 1 : Math.max(0.3, 1 - (0.7 * (age - 2)) / 28);
  if (age < 1) notes.push('Posted today: apply early');

  // Skill edge: rarity-weighted coverage. Matching a skill few jobs ask for is a stronger signal than a common one.
  let edge = null;
  if (corpus?.n && jobSkills.length) {
    const share = (s) => Math.min(...termsOf(s).map((w) => (corpus.df.get(w) || 0) / corpus.n).concat(1));
    // Smoothed IDF: a skill every job lists still weighs 1, so lacking it still costs something.
    const idf = (s) => 1 + Math.log(1 / Math.max(share(s), 1 / (corpus.n + 1)));
    const all = jobSkills.reduce((a, s) => a + weightOf(s) * idf(s), 0);
    edge = all ? matched.reduce((a, s) => a + weightOf(s) * idf(s), 0) / all : null;
    const rare = matched.filter((s) => share(s) < 0.05).sort((a, b) => share(a) - share(b))[0];
    if (rare) notes.push(`Rare skill match: ${rare}`);
  }

  // "Account executive/manager" sell; they share a word with accounting but not the work.
  if (/\baccount (executive|manager|director)\b|\bsales\b|business development/.test(t)
    && !p.skills.some((s) => /sales|business development|account management/i.test(s))) { penalty += 20; notes.push('Sales role'); }

  const relocating = checkLocation(p, job, blockers);
  if (relocating) notes.push('Relocation');
  // Working abroad means a visa, so sponsorship wording blocks relocation jobs too.
  if ((p.needsSponsorship || relocating) && SPONSOR_RE.test(text)) blockers.push('No sponsorship / citizenship or clearance required');

  let cv = null;
  if (corpus && p.cvTerms && Object.keys(p.cvTerms).length) {
    // ponytail: 0.12 cosine ≈ top decile on real data (CV vs ~700 jobs); recalibrate if the corpus changes a lot.
    cv = Math.min(1, cvSimilarity(p.cvTerms, job, corpus) / 0.12);
    if (cv >= 0.8) notes.push('Strong CV fit');
    else if (cv < 0.25) notes.push('Weak CV fit');
  }
  // Per-metric fit (0-100) so the UI can show why a job scored what it did, and calibration can learn from it.
  const pct = (x) => (x == null ? null : Math.round(x * 100));
  const parts = { skills: pct(coverage), title: pct(titleHit), experience: pct(experience), cv: pct(cv), edge: pct(edge),
    seniority: pct(seniority), education: pct(education), pay: pct(pay), freshness: pct(freshness) };
  const score = Math.max(0, Math.min(100, Math.round(combine(parts, weights)) - penalty));
  return { score, eligible: blockers.length === 0, reasons: { matched, missing: missing.slice(0, 6), notes, blockers, parts } };
}

// ---- Calibration: learn metric weights from the user's own decisions, and measure the agreement honestly.
// AUC = chance that a random kept job outscores a random dropped one (0.5 = coin flip, 1 = perfect).
function auc(rows) {
  const pos = rows.filter((r) => r.label === 1), neg = rows.filter((r) => r.label === 0);
  if (!pos.length || !neg.length) return null;
  let win = 0;
  for (const a of pos) for (const b of neg) win += a.s > b.s ? 1 : a.s === b.s ? 0.5 : 0;
  return Math.round((1000 * win) / (pos.length * neg.length)) / 1000;
}

// Logistic regression on the metric vector (missing metrics imputed with their mean); returns non-negative weights summing to 100.
function fitWeights(samples, prior) {
  const means = Object.fromEntries(METRICS.map((k) => {
    const xs = samples.map((s) => s.parts[k]).filter((x) => x != null);
    return [k, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length / 100 : 0.5];
  }));
  const X = samples.map((s) => METRICS.map((k) => (s.parts[k] == null ? means[k] : s.parts[k] / 100)));
  const y = samples.map((s) => s.label);
  const w = METRICS.map(() => 0);
  let b = 0;
  for (let it = 0; it < 800; it++) {
    const gw = METRICS.map(() => 0);
    let gb = 0;
    X.forEach((x, i) => {
      const z = b + x.reduce((a, v, j) => a + v * w[j], 0);
      const err = 1 / (1 + Math.exp(-z)) - y[i];
      x.forEach((v, j) => { gw[j] += err * v; });
      gb += err;
    });
    w.forEach((_, j) => { w[j] -= 2 * (gw[j] / X.length + 0.001 * w[j]); });
    b -= 2 * (gb / X.length);
  }
  const pos = w.map((v) => Math.max(0, v));
  const sum = pos.reduce((a, v) => a + v, 0);
  if (!sum) return { ...prior };
  // Blend with the priors by how much data there is: never more than 70% learned.
  const alpha = Math.min(0.7, samples.length / 100);
  return Object.fromEntries(METRICS.map((k, j) => [k, Math.round(((1 - alpha) * prior[k] + (alpha * 100 * pos[j]) / sum) * 10) / 10]));
}

// samples: [{ id, parts, label: 1 kept (saved/applied) | 0 dropped (passed/hidden) }]
function calibrate(samples, prior = PRIOR_WEIGHTS) {
  const pos = samples.filter((s) => s.label === 1).length, neg = samples.length - pos;
  const base = { active: false, n: samples.length, pos, neg, weights: { ...prior } };
  if (samples.length < 20 || pos < 5 || neg < 5) return base;
  // Held-out check: learn on half the decisions, measure on the other half, so the reported agreement isn't self-graded.
  const sorted = [...samples].sort((a, b) => (a.id < b.id ? -1 : 1));
  const train = sorted.filter((_, i) => i % 2 === 0), test = sorted.filter((_, i) => i % 2 === 1);
  const heldOut = fitWeights(train, prior);
  const rows = (w) => test.map((s) => ({ s: combine(s.parts, w), label: s.label }));
  return { ...base, active: true, weights: fitWeights(samples, prior), aucPrior: auc(rows(prior)), aucLearned: auc(rows(heldOut)) };
}

module.exports = { SKILLS, METRICS, PRIOR_WEIGHTS, findSkills, cvYears, detectRoles, suggestRoles, buildProfile, buildCorpus, jobYears, scoreJob, combine, calibrate, auc };
