// Cover-letter studio: job-aware drafting from your CV, tone + rewrite per block, evidence picker, and an honest coach.
const BLOCKS = [['hook', 'Hook', 'First impression: the role and why you fit'], ['company', 'Why this company', 'Something specific you admire'],
  ['me', 'Why me', 'Your experience in their terms'], ['proof', 'Proof', 'Evidence from your CV'], ['close', 'Close', 'Next step and thanks']];
const TONES = [['formal', 'Formal'], ['confident', 'Confident'], ['warm', 'Warm']];
const lt = { doc: null, ctx: null, saveTimer: null, previewTimer: null };

// ---- drafting (offline templates; every block has variants per tone, "Rewrite" cycles them)
// Skills read naturally mid-sentence: "accounting", but acronyms and mixed-case names (SEC, Power BI) stay as written.
const skillWord = (s) => (/^[A-Z0-9&.+#]{2,}$/.test(s) || /[A-Z]/.test(s.slice(1)) ? s : s.toLowerCase());
const list = (xs) => { const w = xs.map(skillWord); return w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`; };
const lowerFirst = (s) => (/^([A-Z]{2}|I\b)/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
// A CV bullet as something "I" did: "Analyze X" → "I analyze X"; bullets already in first person stay as they are.
const asI = (b) => { const t = sentence(b); return /^(I|My|Our|We)\b/.test(t) ? t : `I ${lowerFirst(t)}`; };
const sentence = (s) => { const t = s.trim().replace(/^[•\-*]\s*/, ''); return /[.!?]$/.test(t) ? t : `${t}.`; };
// "a Data Analyst" / "an Executive …"
const aAn = (w) => `${/^[aeiou]/i.test(w) && !/^(uni|eu|one)/i.test(w) ? 'an' : 'a'} ${w}`;
const DRAFTS = {
  hook: {
    formal: [(c) => `I am writing to apply for the ${c.role} position at ${c.company}. With ${c.yearsText} of experience${c.recent ? `, most recently as ${c.recent.title} at ${c.recent.employer}` : ''}, I am confident I can contribute to your team.`,
      (c) => `Please accept this letter as my application for the ${c.role} role at ${c.company}. My background in ${list(c.skills.slice(0, 2)) || 'this field'} matches what the role requires.`],
    confident: [(c) => `${c.company}'s ${c.role} role calls for ${list(c.skills.slice(0, 3)) || 'the work I do every day'}${c.recent ? `, which is exactly what I do as ${c.recent.title} at ${c.recent.employer}` : ''}. I'd like to bring that experience to your team.`,
      (c) => `I'm applying for the ${c.role} position because it sits squarely where my experience is strongest: ${list(c.skills.slice(0, 3)) || 'the core of this role'}.`],
    warm: [(c) => `When I saw that ${c.company} is looking for ${aAn(c.role)}, I knew straight away that I wanted to apply.${c.recent ? ` In my work as ${c.recent.title} at ${c.recent.employer}, I've grown to love exactly this kind of work.` : ''}`,
      (c) => `I was genuinely excited to come across the ${c.role} opening at ${c.company}, and I'd love to tell you why I think I'd be a good fit.`],
  },
  company: {
    formal: [(c) => `I am particularly drawn to ${c.company} because of [one specific thing: a product, a value or a recent project]. It aligns closely with how I want to develop my career.`],
    confident: [(c) => `What draws me to ${c.company} is [one specific thing you admire]. I want to do my best work somewhere that cares about that, and you clearly do.`],
    warm: [(c) => `I've admired ${c.company} for [one specific thing you admire], and the chance to contribute to that is a big part of why I'm writing.`],
  },
  me: {
    // Each CV bullet starts its own sentence, so bullets written as "My …" or "I …" never land mid-sentence.
    formal: [(c) => `${c.recent ? `I am currently ${c.recent.title} at ${c.recent.employer}. ${asI(c.bullets[0] || 'contribute across the team')}` : 'In my recent work, I have built strong foundations in this area.'}${c.prior ? ` Before that, I was ${c.prior.title} at ${c.prior.employer}. ${asI(c.priorBullet || 'developed a rigorous, detail-oriented approach')}` : ''}`],
    confident: [(c) => `Day to day: ${asI(c.bullets[0] || 'deliver accurate, well-documented work')}${c.bullets[1] ? ` ${asI(c.bullets[1])}` : ''}${c.skills.length ? ` That gives me practical depth in ${list(c.skills.slice(0, 3))}.` : ''}`],
    warm: [(c) => `What I enjoy most in my work is ${c.skills[0] ? `the ${skillWord(c.skills[0])} side` : 'getting the details right'}.${c.recent ? ` I currently work as ${c.recent.title} at ${c.recent.employer}. ${asI(c.bullets[0] || 'help the team deliver reliable results')}` : ''}`],
  },
  proof: {
    formal: [(c) => (c.proof.length ? `For example, ${lowerFirst(c.proof.map(asI).join(' '))}` : 'For example, [add one concrete result: a number, a deadline met or a problem solved].')],
    confident: [(c) => (c.proof.length ? `A recent example: ${c.proof.map(asI).join(' ')}` : 'A recent example: [one result with a number in it].')],
    warm: [(c) => (c.proof.length ? `One thing I'm proud of: ${c.proof.map(asI).join(' ')}` : "One thing I'm proud of: [a result you're proud of].")],
  },
  close: {
    formal: [(c) => `I would welcome the opportunity to discuss how my experience could support ${c.company}. Thank you for your time and consideration.`],
    confident: [(c) => `I'd welcome a conversation about how I can help ${c.company} hit the ground running. Thank you for considering my application.`],
    warm: [(c) => `I'd love the chance to talk about how I could contribute at ${c.company}. Thank you so much for reading my letter.`],
  },
};
function draftBlock(key, tone, ctx, variant = 0) {
  const opts = DRAFTS[key][tone];
  return opts[variant % opts.length](ctx).replace(/\s+/g, ' ').replace(/\.\.(?!\.)/g, '.').trim();
}

// Context: the chosen CV (experience, bullets) + the chosen job (company, role, skills).
async function buildContext(data) {
  const cvDoc = data.cvId ? await api.getDoc(data.cvId) : null;
  const job = data.jobId ? await api.getJob(data.jobId) : null;
  const { profile } = await api.getProfile();
  const exp = cvDoc?.data.sections.find((s) => s.type === 'experience')?.items.filter((e) => e.title || e.subtitle) || [];
  const bulletsOf = (e) => String(e?.description || '').split('\n').map((l) => l.replace(/^[•\-*]\s*/, '').trim()).filter((l) => l.length > 20);
  // The importer reads employer-then-title order from FlowCV; treat title as the role when it reads like one.
  const ROLE_RE = /(analyst|assistant|manager|officer|associate|accountant|auditor|engineer|executive|consultant|specialist|lead|intern)/i;
  const role = (e) => (e ? (!ROLE_RE.test(e.title) && ROLE_RE.test(e.subtitle) ? { title: e.subtitle, employer: e.title } : { title: e.title, employer: e.subtitle }) : null);
  const matched = job?.reasons?.matched || [];
  return {
    personal: cvDoc?.data.personal || { name: profile.name },
    design: cvDoc?.data.design || { template: 'classic', layout: 'single', headerAlign: 'left', heading: 'underline', accent: '#2b59ff', font: 'Segoe UI', size: 10.5, lineHeight: 1.4, margin: 20, spacing: 12, datePos: 'right' },
    company: data.company || job?.company || '[Company]', role: data.role || job?.title || '[Role]',
    yearsText: profile.years ? `${profile.years} year${profile.years === 1 ? '' : 's'}` : 'several years',
    recent: role(exp[0]), prior: role(exp[1]), bullets: bulletsOf(exp[0]), priorBullet: bulletsOf(exp[1])[0],
    skills: matched.length ? matched : profile.skills.slice(0, 5),
    evidence: exp.flatMap((e) => bulletsOf(e).map((b) => ({ text: b, from: [role(e).title, role(e).employer].filter(Boolean).join(' · ') }))),
    jobSkills: { matched, missing: job?.reasons?.missing || [] },
    proof: data.proof || [],
  };
}

// ---- letter document (same design and letterhead as the chosen CV: a matching set)
function renderLetterDoc(data, ctx) {
  const d = ctx.design;
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return h('article', { class: `doc letter head-${d.headerAlign} hs-${d.heading}`, vars: { ...docVars(d), margin: `${Math.max(d.margin, 18)}mm`, lh: Math.max(d.lineHeight, 1.4) } },
    docHeader(ctx.personal),
    h('div', { class: 'letter-meta' }, h('div', { class: 'letter-to' }, [data.recipient || 'Hiring Manager', ctx.company, data.address].filter(Boolean).join('\n')), h('div', {}, data.date || today)),
    h('div', { class: 'letter-subject' }, `Application for ${ctx.role}`),
    h('div', { class: 'letter-body' }, h('p', {}, `Dear ${data.recipient || 'Hiring Manager'},`),
      data.order.map((k) => data.blocks[k]).filter((t) => t && t.trim()).map((t) => h('p', {}, t))),
    h('div', { class: 'letter-sign' }, `${data.signoff || 'Sincerely'},`, h('div', { class: 'doc-name' }, ctx.personal.name || '')));
}

// ---- coach: honest, measurable feedback
const letterText = (data) => data.order.map((k) => data.blocks[k] || '').join('\n');
function coach(data, ctx) {
  const text = letterText(data);
  const words = (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().split(/\s+/).length > 2).length || 1;
  const iCount = (text.match(/\b(I|I'm|I've|I'd|my|me)\b/g) || []).length;
  const youCount = (text.match(/\b(you|your|yours)\b/gi) || []).length + (ctx.company && !ctx.company.startsWith('[') ? text.split(ctx.company).length - 1 : 0);
  const has = (s) => new RegExp(`(?<![\\w+#])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w+#])`, 'i').test(text);
  const placeholders = (text.match(/\[[^\]]+\]/g) || []).length;
  return { words, avg: Math.round(words / sentences), iCount, youCount, balance: youCount / Math.max(1, youCount + iCount), placeholders,
    covered: ctx.jobSkills.matched.filter(has), notYet: ctx.jobSkills.matched.filter((s) => !has(s)), gaps: ctx.jobSkills.missing.filter((s) => !has(s)) };
}
function renderCoach(data, ctx) {
  const c = coach(data, ctx);
  const meter = (label, value, pct, ok, tip) => tipOn(h('div', { class: 'coach-row' }, h('span', {}, label), h('div', { class: 'meter' }, h('span', { style: `width:${Math.max(4, Math.min(100, pct))}%`, class: ok ? 'ok' : 'warn' })), h('b', {}, value)), tip);
  const append = (key, s) => { data.blocks[key] = `${(data.blocks[key] || '').trim()} ${s}`.trim(); letterChanged({ structure: true }); };
  $('#coach').replaceChildren(
    h('div', { class: 'coach-head' }, icon('target'), h('strong', {}, 'Coach'), c.placeholders ? h('span', { class: 'chip warn' }, `${c.placeholders} placeholder${c.placeholders > 1 ? 's' : ''} to fill`) : h('span', { class: 'chip ok' }, icon('check'), 'No placeholders')),
    meter('Length', `${c.words} words`, (100 * c.words) / 400, c.words >= 250 && c.words <= 400, 'Most hiring managers prefer 250-400 words: one page, read in under two minutes.'),
    meter('You vs I', `${Math.round(c.balance * 100)}% about them`, c.balance * 100 * 2, c.balance >= 0.3, 'Letters that talk about the employer’s needs read better than a list of “I did”. Aim for 30%+.'),
    meter('Sentences', `${c.avg} words avg`, 100 - Math.max(0, c.avg - 12) * 6, c.avg <= 24, 'Shorter sentences scan faster. Aim for under 24 words on average.'),
    ctx.jobSkills.matched.length || ctx.jobSkills.missing.length ? h('div', { class: 'coach-keys' },
      h('div', { class: 'help' }, 'Job keywords in your letter'),
      h('div', { class: 'chips' }, c.covered.map((s) => h('span', { class: 'chip ok' }, icon('check'), s)),
        c.notYet.map((s) => tipOn(h('button', { type: 'button', class: 'chip accent', onclick: () => append('me', `I also bring hands-on experience with ${s}.`) }, icon('plus'), s), 'On your CV but not in the letter yet. Click to weave it in.')),
        c.gaps.map((s) => tipOn(h('button', { type: 'button', class: 'chip ghost', onclick: () => append('me', `[How you have used ${s}, only if you genuinely have.]`) }, s), 'The job asks for this and it isn’t on your CV. Only mention it if it’s true; click to add a prompt.')))) : h('p', { class: 'help' }, 'Pick a job to check its keywords against your letter.'));
}

// ---- persistence + preview
function letterChanged({ structure = false } = {}) {
  if (structure) renderLetterEditor();
  clearTimeout(lt.previewTimer);
  lt.previewTimer = setTimeout(() => { const page = renderLetterDoc(lt.doc.data, lt.ctx); $('#letterPage').replaceChildren(page); fitPage($('#letterStage'), page); renderCoach(lt.doc.data, lt.ctx); }, 100);
  $('#letterSaved').textContent = 'Saving…';
  clearTimeout(lt.saveTimer);
  lt.saveTimer = setTimeout(guard(async () => {
    lt.doc.id = await api.saveDoc({ id: lt.doc.id, kind: 'letter', name: lt.doc.name, data: lt.doc.data });
    $('#letterSaved').textContent = 'Saved';
  }), 600);
}
async function loadLetters() {
  const docs = await api.listDocs('letter');
  if (!lt.doc && docs[0]) lt.doc = await api.getDoc(docs[0].id);
  $('#letterPick').replaceChildren(...docs.map((d) => h('option', { value: d.id }, d.name)));
  $('#letterPick').value = lt.doc?.id || '';
  ['#letterDelete', '#letterPdf', '#letterCopy', '#letterName'].forEach((s) => ($(s).disabled = !lt.doc));
  $('#letterName').value = lt.doc?.name || '';
  if (lt.doc) lt.ctx = await buildContext(lt.doc.data);
  renderLetterEditor();
  if (lt.doc) letterChanged();
  else { $('#letterPage').replaceChildren(); $('#coach').replaceChildren(); }
  $('#letterStage').scrollTop = 0;
}

async function newLetter() {
  const cvs = await api.listDocs('cv');
  const jobs = await api.listJobs({ scope: 'matches', sort: 'match' });
  const data = { cvId: cvs[0]?.id || null, jobId: jobs[0]?.id || null, company: '', role: '', recipient: '', address: '', date: '', tone: 'confident',
    signoff: 'Sincerely', order: BLOCKS.map(([k]) => k), blocks: {}, variants: {}, proof: [] };
  const ctx = await buildContext(data);
  // Proof: the CV bullet that mentions most of the job's skills, skipping the ones "Why me" already quotes.
  const keys = [...ctx.jobSkills.matched, ...ctx.jobSkills.missing].map((s) => s.toLowerCase());
  const relevance = (t) => keys.filter((k) => t.toLowerCase().includes(k)).length;
  const fresh = ctx.evidence.filter((e) => !ctx.bullets.slice(0, 2).includes(e.text));
  data.proof = [...fresh].sort((a, b) => relevance(b.text) - relevance(a.text)).slice(0, 1).map((e) => e.text);
  ctx.proof = data.proof;
  for (const [k] of BLOCKS) data.blocks[k] = draftBlock(k, data.tone, ctx);
  const name = `Letter · ${ctx.company}`.slice(0, 80);
  lt.doc = { id: await api.saveDoc({ kind: 'letter', name, data }), name, data };
  await loadLetters();
}

// ---- editor
async function renderLetterEditor() {
  if (!lt.doc) {
    $('#letterEditor').replaceChildren(emptyState('mail', 'Write a cover letter', 'JobPilot drafts it from your CV and the job you pick; you make it yours.',
      btn('New letter', 'plus', guard(newLetter), 'btn btn-primary')));
    return;
  }
  const data = lt.doc.data, ctx = lt.ctx;
  const [cvs, jobs] = await Promise.all([api.listDocs('cv'), api.listJobs({ scope: 'matches', sort: 'match' })]);
  const select = (opts, value, onchange, label) => { const s = h('select', { 'aria-label': label, onchange }, opts.map(([v, t]) => h('option', { value: v }, t))); s.value = value ?? ''; return s; };
  const refreshCtx = guard(async () => { lt.ctx = await buildContext(data); lt.ctx.proof = data.proof; letterChanged({ structure: true }); });
  const redraft = guard(async () => {
    if (!confirm('Redraft every block from your CV and the job? Your edits to the blocks will be replaced.')) return;
    lt.ctx = await buildContext(data);
    for (const [k] of BLOCKS) data.blocks[k] = draftBlock(k, data.tone, { ...lt.ctx, proof: data.proof }, data.variants[k] || 0);
    letterChanged({ structure: true });
  });
  const setup = h('div', { class: 'ed-card' }, h('div', { class: 'ed-card-head' }, icon('briefcase'), h('strong', {}, 'The job')),
    h('label', { class: 'f' }, h('span', {}, 'Job from your matches'), select([['', 'No specific job'], ...jobs.slice(0, 60).map((j) => [j.id, `${j.title} · ${j.company || ''} (${j.score})`])],
      data.jobId, (e) => { data.jobId = e.target.value || null; data.company = ''; data.role = ''; refreshCtx(); }, 'Job')),
    h('div', { class: 'grid-2' },
      h('label', { class: 'f' }, h('span', {}, 'Company'), h('input', { value: data.company || ctx.company, oninput: (e) => { data.company = e.target.value; lt.ctx.company = e.target.value; letterChanged(); } })),
      h('label', { class: 'f' }, h('span', {}, 'Role'), h('input', { value: data.role || ctx.role, oninput: (e) => { data.role = e.target.value; lt.ctx.role = e.target.value; letterChanged(); } })),
      h('label', { class: 'f' }, h('span', {}, 'Recipient'), h('input', { value: data.recipient, placeholder: 'Hiring Manager', oninput: (e) => { data.recipient = e.target.value; letterChanged(); } })),
      h('label', { class: 'f' }, h('span', {}, 'Letterhead and design from'), select(cvs.map((d) => [d.id, d.name]), data.cvId, (e) => { data.cvId = e.target.value; refreshCtx(); }, 'CV'))),
    h('div', { class: 'f' }, h('span', {}, 'Tone'), h('div', { class: 'segmented' }, TONES.map(([v, label]) => h('button', { type: 'button', class: data.tone === v ? 'on' : '', onclick: () => { data.tone = v; letterChanged({ structure: true }); } }, label)))),
    h('div', { class: 'row-actions' }, btn('Redraft all blocks', 'refresh', redraft)));
  const blocks = data.order.map((k, i) => {
    const [, label, hint] = BLOCKS.find(([b]) => b === k);
    return h('div', { class: 'ed-card' },
      h('div', { class: 'ed-card-head' }, h('strong', {}, label), h('span', { class: 'help' }, hint),
        iconBtn('refresh', `Rewrite “${label}” in a ${data.tone} tone`, () => { data.variants[k] = (data.variants[k] || 0) + 1; data.blocks[k] = draftBlock(k, data.tone, { ...lt.ctx, proof: data.proof }, data.variants[k]); letterChanged({ structure: true }); }),
        iconBtn('left', 'Move up', () => { moveIn(data.order, i, i - 1); letterChanged({ structure: true }); }, 'rot-up'),
        iconBtn('right', 'Move down', () => { moveIn(data.order, i, i + 1); letterChanged({ structure: true }); }, 'rot-down')),
      Object.assign(h('textarea', { rows: 4, 'aria-label': label, oninput: (e) => { data.blocks[k] = e.target.value; letterChanged(); } }), { value: data.blocks[k] || '' }));
  });
  const evidence = h('div', { class: 'ed-card' }, h('div', { class: 'ed-card-head' }, icon('check'), h('strong', {}, 'Evidence from your CV'), h('span', { class: 'help' }, 'click to cite in Proof')),
    ctx.evidence.length ? h('ul', { class: 'evidence' }, ctx.evidence.slice(0, 12).map((e) => {
      const on = data.proof.includes(e.text);
      return h('li', {}, h('button', { type: 'button', class: on ? 'on' : '', onclick: () => {
        data.proof = on ? data.proof.filter((x) => x !== e.text) : [...data.proof, e.text].slice(-3);
        data.blocks.proof = draftBlock('proof', data.tone, { ...lt.ctx, proof: data.proof }, data.variants.proof || 0);
        letterChanged({ structure: true });
      } }, icon(on ? 'check' : 'plus'), h('span', {}, e.text), h('em', {}, e.from)));
    })) : h('p', { class: 'help' }, 'Add bullets to your CV’s experience entries to cite them here.'));
  $('#letterEditor').replaceChildren(setup, ...blocks, evidence);
}

// ---- toolbar
$('#letterNew').onclick = guard(newLetter);
$('#letterPick').onchange = guard(async (e) => { lt.doc = await api.getDoc(e.target.value); await loadLetters(); });
$('#letterName').oninput = (e) => { if (lt.doc) { lt.doc.name = e.target.value.slice(0, 80); letterChanged(); } };
$('#letterName').onblur = guard(async () => { if (lt.doc) $('#letterPick').replaceChildren(...(await api.listDocs('letter')).map((d) => h('option', { value: d.id }, d.name))), ($('#letterPick').value = lt.doc.id); });
$('#letterDelete').onclick = guard(async () => {
  if (!confirm(`Delete “${lt.doc.name}”?`)) return;
  await api.deleteDoc(lt.doc.id);
  lt.doc = null;
  await loadLetters();
});
$('#letterCopy').onclick = guard(async () => {
  const d = lt.doc.data;
  const body = [`Dear ${d.recipient || 'Hiring Manager'},`, ...d.order.map((k) => d.blocks[k]).filter(Boolean), `${d.signoff || 'Sincerely'},`, lt.ctx.personal.name].join('\n\n');
  await navigator.clipboard.writeText(body);
  toast('Letter text copied, ready to paste into an application form', 'success');
});
$('#letterPdf').onclick = guard(async () => {
  const page = renderLetterDoc(lt.doc.data, lt.ctx);
  const out = await api.exportPdf({ html: pdfHtml(page, Math.max(lt.ctx.design.margin, 18)), name: lt.doc.name });
  if (out) toast(`Saved ${out}`, 'success');
});
addEventListener('resize', () => { const page = $('#letterPage .doc'); if (page && !$('#letters').hidden) fitPage($('#letterStage'), page); });
