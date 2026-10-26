// Web version of the desktop API (preload.js + main.js handlers): the same calls, backed by Supabase and run in the browser.
// Sign-in gates every call. Jobs come from the shared pool (filled hourly by the fetch-jobs function) and are scored here
// against the user's own profile, so the CV text never leaves the browser.
(() => {
  const sb = window.supabase.createClient(JP_CONFIG.url, JP_CONFIG.key);
  const M = JP('./match'), I = JP('./insights'), D = JP('./cvdoc'), R = JP('./recruiters');
  document.documentElement.classList.add('web');

  const one = async (q) => { const { data, error, count } = await q; if (error) throw new Error(error.message); return count ?? data; };
  // Every row, past the API's 1,000-row page limit.
  async function every(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await one(build().range(from, from + 999));
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  // Postgres timestamps → the desktop's SQLite format ("2026-10-27 09:00:00", UTC), which the UI already parses.
  const sq = (t) => (t ? new Date(t).toISOString().slice(0, 19).replace('T', ' ') : t);
  const fix = (r) => ({ ...r, remote: r.remote ? 1 : 0, eligible: r.eligible ? 1 : 0, found_at: sq(r.found_at), stage_at: sq(r.stage_at), created_at: sq(r.created_at), updated_at: sq(r.updated_at) });
  const listeners = {};
  const emit = (ch, d) => (listeners[ch] || []).forEach((cb) => cb(d));

  // ---- sign-in gate
  let user = null;
  const ready = new Promise((resolve) => {
    sb.auth.getSession().then(({ data }) => (data.session ? resolve((user = data.session.user)) : gate(resolve)));
  });
  function gate(resolve) {
    const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
    const email = el('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com' });
    const password = el('input', { type: 'password', required: true, minLength: 8, autocomplete: 'current-password', placeholder: 'At least 8 characters' });
    const invite = el('input', { required: false, autocomplete: 'off', placeholder: 'From the person who invited you' });
    const inviteRow = el('label', { className: 'f', hidden: true }, el('span', {}, 'Invite code'), invite);
    const msg = el('p', { className: 'auth-msg', role: 'alert' });
    const submit = el('button', { className: 'btn btn-primary', type: 'submit' }, 'Sign in');
    const swap = el('button', { className: 'btn btn-ghost', type: 'button' }, 'New here? Create an account');
    let signUp = false;
    swap.onclick = () => {
      signUp = !signUp;
      inviteRow.hidden = !signUp; invite.required = signUp;
      password.autocomplete = signUp ? 'new-password' : 'current-password';
      submit.textContent = signUp ? 'Create account' : 'Sign in';
      swap.textContent = signUp ? 'Have an account? Sign in' : 'New here? Create an account';
      msg.textContent = '';
    };
    const form = el('form', { className: 'auth-card' },
      el('div', { className: 'auth-brand' }, el('strong', {}, 'JobPilot'), el('span', {}, 'Jobs that match your CV')),
      el('label', { className: 'f' }, el('span', {}, 'Email'), email),
      el('label', { className: 'f' }, el('span', {}, 'Password'), password),
      inviteRow, msg, submit, swap,
      el('p', { className: 'help' }, 'Testing phase: invite only, up to 15 people. Your CV is read in this browser; only the profile drawn from it is saved.'));
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true; msg.textContent = '';
      try {
        if (signUp) {
          const code = invite.value.trim();
          if (!(await one(sb.rpc('invite_ok', { code })))) throw new Error('That invite code is not valid, already used, or JobPilot is full.');
          const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: password.value, options: { data: { invite: code } } });
          if (error) throw error;
          if (!data.session) throw new Error('Account created. Confirm the link in your email, then sign in.');
          user = data.session.user;
        } else {
          const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
          if (error) throw error;
          user = data.user;
        }
        wrap.remove();
        resolve(user);
      } catch (err) { msg.textContent = err.message || String(err); } finally { submit.disabled = false; }
    };
    const wrap = el('div', { className: 'auth-gate' }, form);
    const mount = () => { document.body.append(wrap); email.focus(); };
    document.body ? mount() : document.addEventListener('DOMContentLoaded', mount);
  }

  // ---- profile and scoring
  let prof = null, syncedAt = null;
  async function profile() {
    if (!prof) {
      const r = await one(sb.from('profiles').select('data, synced_at').maybeSingle());
      prof = { ...M.DEFAULT_PROFILE, ...(r?.data || {}) };
      syncedAt = r?.synced_at || null;
    }
    return prof;
  }
  async function saveProfile(p) {
    prof = p;
    await one(sb.from('profiles').upsert({ user_id: user.id, data: p }));
  }

  async function scoringContext() {
    const m = Object.fromEntries((await one(sb.from('meta').select('key, value'))).map((r) => [r.key, r.value]));
    return { corpus: { ...M.corpusFromJson(m.corpus || {}), fx: m.fx || null }, last: m.last_fetch || null };
  }

  const decisions = async () => (await every(() => sb.from('user_jobs').select('job_id, status, reasons')
    .or('status.in.(saved,applied,hidden),and(status.eq.new,reviewed.is.true)').order('job_id')))
    .map((r) => ({ id: r.job_id, parts: r.reasons.parts || {}, label: r.status === 'saved' || r.status === 'applied' ? 1 : 0 }))
    .filter((r) => Object.keys(r.parts).length);

  // Pull pool jobs added since the last sync (all of them when full), score them, store the scores.
  // ponytail: a full re-score downloads the whole pool (~a few MB); fine for 15 users, score server-side if the pool grows a lot.
  let running = null, needFull = false, lastFetch = null;
  function refresh(full = false) {
    needFull ||= full;
    return (running ??= (async () => {
      let r;
      try { do { const f = needFull; needFull = false; r = await sync(f); } while (needFull); } finally { running = null; emit('refreshing', false); }
      return r;
    })());
  }
  async function sync(full) {
    let p = await profile();
    if (!p.skills.length) return { error: 'Upload your CV in Profile first.' };
    emit('refreshing', true);
    const calibration = M.calibrate(await decisions());
    if (JSON.stringify(calibration) !== JSON.stringify(p.calibration)) { await saveProfile((p = { ...p, calibration })); full = true; }
    const { corpus, last } = await scoringContext();
    lastFetch = last;
    const firstRun = !syncedAt;
    const since = full || firstRun ? null : syncedAt;
    const jobs = await every(() => { const q = sb.from('jobs_pool').select('*').order('fetched_at').order('id'); return since ? q.gt('fetched_at', since) : q; });
    const rows = [], fresh = [], contacts = [];
    for (const j of jobs) {
      const m = M.scoreJob(p, j, corpus);
      rows.push({ user_id: user.id, job_id: j.id, score: m.score, eligible: m.eligible, reasons: m.reasons });
      if (m.eligible && m.score >= p.minScore) fresh.push(j);
      if (m.eligible) for (const c of R.contactsFromText(`${j.description || ''}\n${(j.emails || []).join(' ')}`)) contacts.push({ ...c, company: j.company, job_id: j.id });
    }
    for (let i = 0; i < rows.length; i += 500) await one(sb.from('user_jobs').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,job_id' }));
    const people = contacts.filter((c) => c.email).map((c) => ({ user_id: user.id, name: String(c.name || c.email).slice(0, 100), title: String(c.title || '').slice(0, 200),
      company: String(c.company || '').slice(0, 100), email: String(c.email).slice(0, 200), job_id: c.job_id, source: 'job posting' }));
    if (people.length) await one(sb.from('recruiters').upsert(people, { onConflict: 'user_id,email', ignoreDuplicates: true }));
    // A first or full sync would alert on everything; new pool jobs only.
    const isNew = !full && !firstRun;
    if (isNew && fresh.length) await one(sb.from('alerts').upsert(fresh.map((j) => ({ user_id: user.id, job_id: j.id })), { onConflict: 'user_id,job_id', ignoreDuplicates: true }));
    if (jobs.length) {
      syncedAt = jobs.reduce((a, j) => (j.fetched_at > a ? j.fetched_at : a), syncedAt || '');
      await one(sb.from('profiles').update({ synced_at: syncedAt }).eq('user_id', user.id));
    }
    const result = { at: last?.at || new Date().toISOString(), fetched: jobs.length, fresh: isNew ? fresh.length : 0, status: last?.status || {} };
    emit('updated', result);
    return result;
  }

  // ---- feed queries
  const LIST = 'id, source, title, company, location, remote, url, posted_at, score, eligible, reasons, status, stage, stage_at, found_at, job_type, salary, posted';
  async function listJobs(raw) {
    const f = { ...I.jobFilters(raw), unreviewed: !!raw?.unreviewed };
    let q = sb.from('my_jobs').select(LIST).neq('status', 'hidden');
    if (f.scope !== 'all') q = q.eq('eligible', true).gte('score', f.minScore);
    const t = f.q.replace(/[,()*"\\:]/g, ' ').trim();
    if (t) q = q.or(`title.ilike."*${t}*",company.ilike."*${t}*",description.ilike."*${t}*"`);
    if (f.location) q = q.ilike('location', `%${f.location}%`);
    if (f.days) q = q.gte('posted', new Date(Date.now() - f.days * 864e5).toISOString());
    if (f.workplace) q = q.eq('remote', f.workplace === 'remote');
    if (f.jobType) q = q.ilike('job_type', `%${f.jobType}%`);
    if (f.salaryOnly) q = q.not('salary', 'is', null);
    if (f.unreviewed) q = q.eq('status', 'new').eq('reviewed', false);
    const [a, b] = f.sort === 'newest' ? ['posted', 'score'] : ['score', 'posted'];
    return (await one(q.order(a, { ascending: false }).order(b, { ascending: false }).limit(500))).map(fix).reduce(I.dedupe, []);
  }
  const matches = async () => listJobs({ scope: 'matches', minScore: (await profile()).minScore });
  const myJobs = async () => (await one(sb.from('my_jobs').select(LIST).in('status', ['saved', 'applied']).order('found_at', { ascending: false }))).map(fix);
  const count = (build) => one(build(sb.from('user_jobs').select('*', { count: 'exact', head: true })));

  async function setJobStatus(id, status) {
    const cur = await one(sb.from('user_jobs').select('status, stage, stage_at').eq('job_id', id).single());
    await one(sb.from('user_jobs').update({ status, reviewed: true, stage: status === 'applied' ? cur.stage || 'applied' : null,
      stage_at: ['saved', 'applied'].includes(status) && cur.status !== status ? new Date().toISOString() : cur.stage_at }).eq('job_id', id));
  }

  // ---- files: CV text from PDF, DOCX or TXT, read in the browser
  const pickFile = (accept) => new Promise((resolve) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept });
    i.onchange = () => resolve(i.files[0] || null);
    i.addEventListener('cancel', () => resolve(null));
    i.click();
  });
  async function pickCvText() {
    const file = await pickFile('.pdf,.docx,.txt,.md');
    if (!file) return null;
    if (file.size > 5e6) throw new Error('That file is over 5 MB. Export a smaller PDF or a DOCX.');
    const ext = file.name.toLowerCase().split('.').pop();
    let text;
    if (ext === 'pdf') {
      const pdfjs = await import('./vendor/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href;
      try {
        const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
        const pages = [];
        for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''));
        text = pages.join('\n');
      } catch (e) { throw new Error(`Could not read that PDF (${e?.message || e}). Try a DOCX or TXT export.`); }
    } else if (ext === 'docx') text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    else text = await file.text();
    if (text.trim().length < 50) throw new Error('Could not read text from that file (scanned PDF?). Try a DOCX or TXT export.');
    return { name: file.name, text };
  }

  // ---- the API the UI calls (same names and results as preload.js)
  const calls = {
    getProfile: async () => ({ profile: await profile(), keys: {} }),
    async uploadCv() {
      const picked = await pickCvText();
      if (!picked) return null;
      const p = { ...(await profile()), ...M.buildProfile(picked.text), cvFile: picked.name.slice(0, 120) };
      await saveProfile(p);
      needFull = true;
      return p;
    },
    async saveProfile(input) {
      const p = M.profileFromForm(await profile(), input || {});
      await saveProfile(p);
      refresh(true);
      return p;
    },
    saveKeys: () => { throw new Error('Online, API keys are managed by the admin.'); },
    refresh: () => refresh(),
    listJobs,
    getJob: async (id) => { const r = await one(sb.from('my_jobs').select('*').eq('id', String(id)).maybeSingle()); return r && fix(r); },
    myJobs,
    reviewQueue: async () => listJobs({ scope: 'matches', minScore: (await profile()).minScore, unreviewed: true }),
    markReviewed: (id) => one(sb.from('user_jobs').update({ reviewed: true }).eq('job_id', String(id))),
    undoReview: (id) => one(sb.from('user_jobs').update({ reviewed: false, status: 'new', stage: null }).eq('job_id', String(id))),
    async briefing(lastSeen) {
      const list = await matches();
      const seen = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(lastSeen || '') ? lastSeen : null;
      return I.briefing({ matches: list, mine: await myJobs(), queue: list.filter((j) => j.status === 'new' && !j.reviewed).length, lastSeen: seen });
    },
    insights: async () => I.insights(await matches()),
    async stats() {
      const p = await profile(), list = await matches(), dayAgo = Date.now() - 864e5;
      const [total, saved, applied, interview, offer, toReview] = await Promise.all([
        count((q) => q.neq('status', 'hidden')), count((q) => q.eq('status', 'saved')),
        count((q) => q.eq('status', 'applied').or('stage.is.null,stage.eq.applied')), count((q) => q.eq('stage', 'interview')), count((q) => q.eq('stage', 'offer')),
        listJobs({ scope: 'matches', minScore: p.minScore, unreviewed: true }).then((l) => l.length)]);
      return { total, saved, applied, interview, offer, toReview, matches: list.length, last: lastFetch, priorWeights: M.PRIOR_WEIGHTS,
        calibration: p.calibration || { active: false, n: 0, pos: 0, neg: 0, weights: M.PRIOR_WEIGHTS },
        newToday: list.filter((j) => new Date(`${j.found_at.replace(' ', 'T')}Z`) >= dayAgo).length,
        strong: list.filter((j) => j.reasons.notes.includes('Strong CV fit')).length };
    },
    setJobStage: (id, stage) => one(sb.from('user_jobs').update({ status: 'applied', stage: String(stage), reviewed: true, stage_at: new Date().toISOString() }).eq('job_id', String(id))),
    setJobStatus: (id, status) => setJobStatus(String(id), String(status)),
    listAlerts: async () => (await one(sb.from('my_alerts').select('*').order('id', { ascending: false }).limit(200))).map(fix),
    unreadAlerts: () => one(sb.from('alerts').select('*', { count: 'exact', head: true }).eq('read', false)),
    readAlerts: () => one(sb.from('alerts').update({ read: true }).eq('read', false)),
    async listRecruiters() {
      const people = (await one(sb.from('my_recruiters').select('*').neq('status', 'ignored').order('id', { ascending: false }))).map(fix);
      const by = new Map();
      for (const j of await matches()) {
        if (!j.company) continue;
        const c = by.get(j.company) || { company: j.company, jobs: 0, best: 0 };
        c.jobs++; c.best = Math.max(c.best, j.score);
        by.set(j.company, c);
      }
      const companies = [...by.values()].sort((a, b) => b.best - a.best || b.jobs - a.jobs).slice(0, 60).map((c) => ({ ...c, search: R.peopleSearchUrl(c.company) }));
      return { people, companies };
    },
    setRecruiterStatus: (id, status) => one(sb.from('recruiters').update({ status: String(status) }).eq('id', +id)),
    listDocs: async (kind) => (await one(sb.from('documents').select('id, name, updated_at').eq('kind', kind === 'letter' ? 'letter' : 'cv')
      .order('updated_at', { ascending: false }).order('name'))).map(fix),
    getDoc: async (id) => { const r = await one(sb.from('documents').select('*').eq('id', String(id)).maybeSingle()); return r && fix(r); },
    async saveDoc(doc = {}) {
      if (!doc.data || typeof doc.data !== 'object' || JSON.stringify(doc.data).length > 1e6) throw new Error('Document is empty or too large.');
      const id = /^[a-z0-9]{6,40}$/.test(doc.id || '') ? doc.id : D.uid();
      await one(sb.from('documents').upsert({ id, user_id: user.id, kind: doc.kind === 'letter' ? 'letter' : 'cv',
        name: (typeof doc.name === 'string' ? doc.name.trim().slice(0, 80) : '') || 'Untitled', data: doc.data, updated_at: new Date().toISOString() }));
      return id;
    },
    deleteDoc: (id) => one(sb.from('documents').delete().eq('id', String(id))),
    newCv: async () => D.newCv(await profile()),
    async importCv() {
      const picked = await pickCvText();
      if (!picked) return null;
      const data = D.parseCvText(picked.text), p = await profile();
      // Many CV designs show skills as graphics, so the text has no Skills heading: fall back to the profile's skills.
      if (!data.sections.some((s) => s.type === 'skills') && p.skills.length) data.sections.push({ ...D.newCv(p).sections.find((s) => s.type === 'skills') });
      return { name: picked.name.replace(/\.[^.]+$/, ''), data };
    },
    // The browser's print dialog ("Save as PDF") in a script-less frame styled by doc.css.
    exportPdf({ html, name } = {}) {
      if (typeof html !== 'string' || !html || html.length > 3e6) throw new Error('Nothing to export.');
      const f = Object.assign(document.createElement('iframe'), { title: 'Print', sandbox: 'allow-same-origin allow-modals' });
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      const title = String(name || 'Document').replace(/[<>&"]/g, ' ').slice(0, 80);
      f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="doc.css"></head><body class="print">${html}</body></html>`;
      return new Promise((resolve) => {
        f.onload = () => { f.contentWindow.print(); setTimeout(() => f.remove(), 1000); resolve(null); };
        document.body.append(f);
      });
    },
    openExternal(url) {
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      else if (/^mailto:[^\s/]+@[^\s/]+$/i.test(url)) location.href = url;
    },
  };

  window.api = {
    ...Object.fromEntries(Object.entries(calls).map(([k, fn]) => [k, async (...a) => { await ready; return fn(...a); }])),
    on: (ch, cb) => (listeners[ch] ||= []).push(cb),
  };

  // ---- account card on the Profile page, then keep jobs current while the tab is open
  ready.then(() => {
    const add = () => {
      const btn = (label, onclick, cls = 'btn') => Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: label, onclick });
      const card = document.createElement('div');
      card.className = 'card account';
      const who = Object.assign(document.createElement('div'), { className: 'grow' });
      who.append(Object.assign(document.createElement('div'), { className: 'strong', textContent: 'Account' }), Object.assign(document.createElement('div'), { className: 'muted', textContent: user.email }));
      card.append(who,
        btn('Change password', async () => {
          const pw = window.prompt('New password (at least 8 characters)');
          if (!pw) return;
          const { error } = await sb.auth.updateUser({ password: pw });
          window.alert(error ? error.message : 'Password changed.');
        }),
        btn('Sign out', async () => { await sb.auth.signOut(); location.reload(); }),
        btn('Delete account', async () => {
          if (!window.confirm('Delete your account and everything in it (profile, jobs, CVs, letters)? This cannot be undone.')) return;
          await one(sb.rpc('delete_me'));
          await sb.auth.signOut();
          location.reload();
        }, 'btn btn-danger'));
      document.querySelector('#profile .settings')?.prepend(card);
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', add) : add();
    refresh();
    setInterval(refresh, 30 * 60 * 1000);
  });
})();
