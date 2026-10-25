// Recruiter discovery: contacts in job text + the LinkedIn "hiring team" box the user is viewing.

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LI_RE = /linkedin\.com\/in\/([\w%-]+)/g;
const SKIP_EMAIL = /^(no-?reply|donotreply|privacy|abuse)@/i;

function contactsFromText(text = '') {
  const emails = [...new Set(text.match(EMAIL_RE) || [])].filter((e) => !SKIP_EMAIL.test(e));
  const profiles = [...new Set([...text.matchAll(LI_RE)].map((m) => m[1]))];
  return [
    ...emails.map((email) => ({ name: email.split('@')[0].replace(/[._]/g, ' '), email })),
    ...profiles.map((slug) => ({ name: decodeURIComponent(slug).replace(/-[\da-f]{3,}$/i, '').replace(/-/g, ' '), profile_url: `https://www.linkedin.com/in/${slug}` })),
  ];
}

const peopleSearchUrl = (company) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`recruiter ${company}`)}`;

// Injected into LinkedIn job pages in the Portals webview. Reads only what the user is looking at.
// ponytail: LinkedIn markup changes often; this keys off the heading text + /in/ links, update if it stops finding people.
const HIRING_TEAM_SCRIPT = `(() => {
  const heading = [...document.querySelectorAll('h2,h3')].find(h => /meet the hiring team|people you can reach out to/i.test(h.textContent));
  if (!heading) return [];
  let box = heading.parentElement;
  while (box && !box.querySelector('a[href*="/in/"]')) box = box.parentElement;
  if (!box) return [];
  const company = (document.querySelector('[class*="company-name"]')?.textContent || '').trim();
  const jobTitle = (document.querySelector('h1')?.textContent || '').trim();
  const seen = new Set();
  return [...box.querySelectorAll('a[href*="/in/"]')].map(a => {
    const url = a.href.split('?')[0].replace(/\\/$/, '');
    if (seen.has(url)) return null;
    seen.add(url);
    const lines = (a.closest('li,div')?.innerText || a.innerText).split('\\n').map(s => s.trim()).filter(Boolean);
    return lines[0] ? { name: lines[0], title: lines.find((l, i) => i > 0 && l.length > 12) || '', profile_url: url, company, job_title: jobTitle } : null;
  }).filter(Boolean);
})()`;

module.exports = { contactsFromText, peopleSearchUrl, HIRING_TEAM_SCRIPT };
