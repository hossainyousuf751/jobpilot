// CV → profile extraction and job scoring. Pure functions, no Electron.

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

function buildProfile(text) {
  return { skills: findSkills(text), years: cvYears(text), roles: detectRoles(text) };
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

function scoreJob(p, job) {
  const title = job.title || '';
  const desc = job.description || '';
  const text = `${title}\n${desc}`;
  const blockers = [], notes = [];
  let penalty = 0;

  const extra = p.skills.filter((s) => !SKILLS.some((k) => k.toLowerCase() === s.toLowerCase()));
  const jobSkills = findSkills(text, [...SKILLS, ...extra]);
  const have = new Set(p.skills.map((s) => s.toLowerCase()));
  const matched = jobSkills.filter((s) => have.has(s.toLowerCase()));
  const missing = jobSkills.filter((s) => !have.has(s.toLowerCase()));
  // At least 3 in the denominator: one generic shared skill shouldn't mean full coverage.
  const coverage = jobSkills.length ? matched.length / Math.max(3, jobSkills.length) : 0.3;

  const tw = words(title);
  const titleHit = Math.max(0, ...p.roles.map((r) => {
    const rw = words(r);
    return rw.length ? rw.filter((w) => tw.some((t) => sameStem(w, t))).length / rw.length : 0;
  }));
  // Nothing in the title relates to your roles: generic skill words alone shouldn't make it a match.
  if (titleHit === 0) penalty += 10;

  const need = jobYears(desc);
  if (need != null && need > p.years + 1) blockers.push(`Needs ${need}+ yrs (you have ${p.years})`);

  const t = title.toLowerCase();
  if (/\b(director|vp|vice president|head of|chief)\b/.test(t) && p.years < 8) blockers.push('Executive-level role');
  else if (/\b(senior|sr\.?|lead|principal|staff)\b/.test(t) && p.years < 4) { penalty += 15; notes.push('Senior title'); }
  if (/\b(intern|internship|graduate|junior|jr\.?|entry)\b/.test(t) && p.years > 5) { penalty += 10; notes.push('Junior role'); }

  const relocating = checkLocation(p, job, blockers);
  if (relocating) notes.push('Relocation');
  // Working abroad means a visa, so sponsorship wording blocks relocation jobs too.
  if ((p.needsSponsorship || relocating) && SPONSOR_RE.test(text)) blockers.push('No sponsorship / citizenship or clearance required');

  const yearsFit = need == null || need <= p.years ? 1 : 0.5;
  const score = Math.max(0, Math.min(100, Math.round(55 * coverage + 30 * titleHit + 15 * yearsFit) - penalty));
  return { score, eligible: blockers.length === 0, reasons: { matched, missing: missing.slice(0, 6), notes, blockers } };
}

module.exports = { SKILLS, findSkills, cvYears, detectRoles, buildProfile, jobYears, scoreJob };
