// CV documents for the builder: the data model, presets, and a heuristic importer from CV text. Pure functions, no I/O.

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Section kinds: text (one rich paragraph block), entries (title/subtitle/dates/bullets), tags (name + optional level).
const SECTION_PRESETS = {
  profile: { title: 'Profile', kind: 'text' },
  experience: { title: 'Professional Experience', kind: 'entries', labels: ['Job title', 'Employer'] },
  education: { title: 'Education', kind: 'entries', labels: ['Degree', 'School'] },
  skills: { title: 'Skills', kind: 'tags' },
  languages: { title: 'Languages', kind: 'tags' },
  projects: { title: 'Projects', kind: 'entries', labels: ['Project', 'Role or subtitle'] },
  courses: { title: 'Courses & Certificates', kind: 'entries', labels: ['Course', 'Institution'] },
  publications: { title: 'Publications', kind: 'entries', labels: ['Title', 'Publisher'] },
  awards: { title: 'Achievements', kind: 'entries', labels: ['Award', 'Issuer'] },
  references: { title: 'References', kind: 'entries', labels: ['Name', 'Role and organisation'] },
  custom: { title: 'Custom section', kind: 'entries', labels: ['Title', 'Subtitle'] },
};

const DESIGN_DEFAULT = { template: 'classic', layout: 'single', headerAlign: 'left', heading: 'underline', accent: '#2b59ff',
  font: 'Segoe UI', size: 10.5, lineHeight: 1.35, margin: 16, spacing: 12, datePos: 'right' };

const section = (type, extra = {}) => ({ id: uid(), type, title: SECTION_PRESETS[type].title, kind: SECTION_PRESETS[type].kind, hidden: false, text: '', items: [], ...extra });
const entry = (o = {}) => ({ id: uid(), title: '', subtitle: '', location: '', start: '', end: '', description: '', ...o });
const tag = (name, level = '') => ({ id: uid(), name, level });

// A fresh CV from what the profile already knows.
function newCv(profile = {}) {
  return {
    personal: { name: profile.name || '', title: profile.roles?.[0] || '', email: '', phone: '', location: profile.locations?.[0] || '', links: [] },
    sections: [section('profile'), section('experience', { items: [entry()] }), section('education', { items: [entry()] }),
      section('skills', { items: (profile.skills || []).slice(0, 16).map((s) => tag(s)) }), section('languages')],
    design: { ...DESIGN_DEFAULT },
  };
}

// ---- Importer: CV text (from PDF/DOCX/TXT) → sections and entries. Heuristic; the user edits the result.
const HEADS = [
  [/^(profile|summary|professional summary|about me|career objective|objective)$/i, 'profile'],
  [/^((professional|work|relevant) )?experience$|^employment( history)?$|^work history$/i, 'experience'],
  [/^(education|academic background|academics?)$/i, 'education'],
  [/^(skills|key skills|core competencies|technical skills)$/i, 'skills'],
  [/^languages?$/i, 'languages'],
  [/^projects?$/i, 'projects'],
  [/^(courses|certificates|certifications?|training|extended learning)$/i, 'courses'],
  [/^(publications?|research)$/i, 'publications'],
  [/^(achievements.*|awards.*|honou?rs|conferences?|extracurriculars?|volunteer.*)$/i, 'awards'],
  [/^references?$/i, 'references'],
];
const headOf = (line) => HEADS.find(([re]) => re.test(line.trim()))?.[1];
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const POINT = `(?:(?:\\d{1,2}/){0,2}|${MONTH}\\s+)?(?:19|20)\\d{2}`;
const DATE_LINE = new RegExp(`^(${POINT})(?:\\s*[–—-]\\s*(${POINT}|present|current|now|ongoing))?$`, 'i');
const LOCATION = /^[A-Z][\w.' ()-]{1,30}, [A-Z][\w.' -]{1,25}$/;
const BULLET = /^[•▪●◦‣\-–*]\s*/;
const LINK_LABEL = /^(certificate|transcript|linkedin|orcid|research ?gate|google scholar|github|portfolio|website)$/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /^\(?\+?[\d\s()-]{7,}$/;
// A heading-like line: short, capitalised, no colon, not a sentence ending.
const isHeader = (l) => l.length <= 60 && /^[\p{Lu}\d]/u.test(l) && !l.includes(':') && !/[.,;]$/.test(l);

function parseEntries(lines) {
  const items = [];
  let cur = null;
  const add = (text) => {
    const desc = cur.desc;
    // Continuation of a wrapped line: starts lowercase or the previous line clearly runs on.
    if (desc.length && (/^[\p{Ll}(&]/u.test(text) || /[,&]$|\b(and|of|the|to|in|for|with|a)$/i.test(desc[desc.length - 1]))) desc[desc.length - 1] += ` ${text}`;
    else desc.push(text);
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || LINK_LABEL.test(l)) continue;
    const d = DATE_LINE.exec(l);
    if (d && cur) { if (!cur.start) { cur.start = d[1]; cur.end = d[2] || ''; } continue; }
    if (LOCATION.test(l) && cur && cur.start && !cur.location) { cur.location = l; continue; }
    if (BULLET.test(l)) { if (!cur) cur = { headers: [], desc: [], start: '', end: '', location: '', bulleted: true }, items.push(cur); cur.desc.push(l.replace(BULLET, '')); cur.inDesc = true; cur.bulleted = true; continue; }
    if (isHeader(l) && (!cur || cur.inDesc || cur.headers.length >= 2 || cur.start)) {
      if (!cur || cur.inDesc || cur.headers.length >= 2 || (cur.start && cur.headers.length)) { cur = { headers: [], desc: [], start: '', end: '', location: '' }; items.push(cur); }
      cur.headers.push(l);
      continue;
    }
    if (isHeader(l) && cur && !cur.inDesc) { cur.headers.push(l); continue; }
    if (!cur) { cur = { headers: [], desc: [], start: '', end: '', location: '' }; items.push(cur); }
    add(l);
    cur.inDesc = true;
  }
  return items.map((c) => entry({ title: c.headers[0] || '', subtitle: c.headers.slice(1).join(' · '), location: c.location, start: c.start, end: c.end,
    description: c.desc.map((x) => (c.bulleted ? `• ${x}` : x)).join('\n') }));
}

const ROLE_WORD = /\b(analyst|assistant|manager|officer|associate|accountant|auditor|engineer|developer|executive|consultant|specialist|lead|intern|director|coordinator|designer|scientist|researcher|teacher|administrator)\b/i;
const DEGREE_WORD = /\b(bachelor|master|msc|bsc|ba|ma|mba|bba|phd|doctorate|diploma|certificate|degree|hsc|ssc|a-?levels?)\b/i;
// Entries print as "Employer / Job title" (or "School / Degree"); the builder's title is the role or degree.
function roleFirst(items, re) {
  return items.map((e) => {
    const [a, ...rest] = e.subtitle.split(' · ');
    return a && re.test(a) && !re.test(e.title) ? { ...e, title: a, subtitle: [e.title, ...rest].join(' · ') } : e;
  });
}

function parseCvText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const firstHead = lines.findIndex((l) => headOf(l));
  const top = (firstHead < 0 ? lines : lines.slice(0, firstHead)).filter(Boolean);
  const email = top.map((l) => EMAIL.exec(l)?.[0]).find(Boolean) || '';
  const phones = top.filter((l) => PHONE.test(l));
  const personal = {
    name: top[0] || '',
    title: top[1] && !EMAIL.test(top[1]) && !PHONE.test(top[1]) ? top[1] : '',
    email, phone: phones.join(' · '),
    // First plain line after the name/title that isn't contact info, a link label or a date (dates of birth are not imported).
    location: top.slice(2).find((l) => !EMAIL.test(l) && !PHONE.test(l) && !LINK_LABEL.test(l) && !/\d{1,2}(st|nd|rd|th)? \w+ (19|20)\d{2}|(19|20)\d{2}$/.test(l)) || '',
    links: [],
  };
  const sections = [];
  let cur = null;
  for (const l of firstHead < 0 ? [] : lines.slice(firstHead)) {
    const type = headOf(l);
    if (type) { cur = { type, heading: l.trim(), lines: [] }; sections.push(cur); } else if (cur) cur.lines.push(l);
  }
  return {
    personal,
    sections: sections.map((s) => {
      const base = section(s.type, { title: s.heading });
      if (base.kind === 'text') {
        // Paragraph breaks where a line ends a sentence.
        return { ...base, text: s.lines.filter(Boolean).reduce((acc, l) => (acc && !/[.!?]$/.test(acc) ? `${acc} ${l}` : acc ? `${acc}\n${l}` : l), '') };
      }
      if (base.kind === 'tags') return { ...base, items: s.lines.join(',').split(/[,•;|]/).map((x) => x.trim()).filter(Boolean).map((x) => tag(x)) };
      const items = parseEntries(s.lines);
      return { ...base, items: s.type === 'experience' ? roleFirst(items, ROLE_WORD) : s.type === 'education' ? roleFirst(items, DEGREE_WORD) : items };
    }),
    design: { ...DESIGN_DEFAULT },
  };
}

module.exports = { SECTION_PRESETS, DESIGN_DEFAULT, newCv, parseCvText, uid };
