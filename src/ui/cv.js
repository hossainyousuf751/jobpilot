// CV builder (FlowCV-style): structured editor on the left, live A4 preview on the right, PDF export.
// Typing updates the model and preview only; structural changes (add/move/delete) re-render the editor.
const PRESETS = {
  profile: ['Profile', 'text'], experience: ['Professional Experience', 'entries', 'Job title', 'Employer'], education: ['Education', 'entries', 'Degree', 'School'],
  skills: ['Skills', 'tags'], languages: ['Languages', 'tags'], projects: ['Projects', 'entries', 'Project', 'Role or subtitle'],
  courses: ['Courses & Certificates', 'entries', 'Course', 'Institution'], publications: ['Publications', 'entries', 'Title', 'Publisher'],
  awards: ['Achievements', 'entries', 'Award', 'Issuer'], references: ['References', 'entries', 'Name', 'Role and organisation'], custom: ['Custom section', 'entries', 'Title', 'Subtitle'],
};
const TEMPLATES = {
  classic: { label: 'Classic', layout: 'single', headerAlign: 'left', heading: 'underline', accent: '#2b59ff', font: 'Segoe UI', size: 10.5, lineHeight: 1.35, margin: 16, spacing: 12, datePos: 'right' },
  modern: { label: 'Modern', layout: 'left', headerAlign: 'left', heading: 'bar', accent: '#0f9d94', font: 'Segoe UI', size: 10, lineHeight: 1.35, margin: 14, spacing: 11, datePos: 'right' },
  executive: { label: 'Executive', layout: 'single', headerAlign: 'center', heading: 'plain', accent: '#1f2937', font: 'Georgia', size: 10.5, lineHeight: 1.4, margin: 18, spacing: 13, datePos: 'right' },
  compact: { label: 'Compact', layout: 'right', headerAlign: 'left', heading: 'box', accent: '#c4314b', font: 'Calibri', size: 9.5, lineHeight: 1.25, margin: 12, spacing: 8, datePos: 'below' },
};
const FONTS = ['Segoe UI', 'Calibri', 'Arial', 'Georgia', 'Cambria', 'Palatino Linotype', 'Constantia'];
const SWATCHES = ['#2b59ff', '#0f9d94', '#1f2937', '#c4314b', '#b4570a', '#0e7a3e', '#4f6bed', '#7a49b8'];
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const blankEntry = () => ({ id: newId(), title: '', subtitle: '', location: '', start: '', end: '', description: '' });

const cv = { doc: null, tab: 'content', collapsed: new Set(), saveTimer: null, previewTimer: null };

// ---- rendering the document (shared with the cover letter for header + design)
function docVars(d) {
  return { accent: d.accent, font: `"${d.font}", system-ui, sans-serif`, size: `${d.size}pt`, lh: d.lineHeight, margin: `${d.margin}mm`, gap: `${d.spacing}pt` };
}
function docHeader(p) {
  const contact = [p.email, p.phone, p.location, ...(p.links || [])].filter(Boolean);
  return h('header', { class: 'doc-head' }, h('h1', { class: 'doc-name' }, p.name || 'Your Name'), p.title && h('div', { class: 'doc-title' }, p.title),
    contact.length ? h('div', { class: 'doc-contact' }, contact.map((c) => h('span', {}, c))) : null);
}
const dateRange = (e) => [e.start, e.end].filter(Boolean).join(' – ');
function docDesc(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const bullets = lines.filter((l) => /^[•\-*]/.test(l));
  // Bulleted lines become a list; other lines stay paragraphs, in order.
  return h('div', { class: 'doc-desc' }, bullets.length === lines.length
    ? h('ul', {}, lines.map((l) => h('li', {}, l.replace(/^[•\-*]\s*/, ''))))
    : lines.map((l) => (/^[•\-*]/.test(l) ? h('ul', {}, h('li', {}, l.replace(/^[•\-*]\s*/, ''))) : h('p', {}, l))));
}
function docSection(s) {
  const body = s.kind === 'text' ? (s.text ? h('div', { class: 'doc-text' }, s.text) : null)
    : s.kind === 'tags' ? (s.items.length ? h('ul', { class: 'doc-tags' }, s.items.filter((t) => t.name).map((t) => h('li', {}, t.name,
      t.level ? h('span', { class: 'doc-level', 'aria-label': `level ${t.level} of 5` }, '●'.repeat(t.level) + '○'.repeat(5 - t.level)) : null))) : null)
      : s.items.filter((e) => e.title || e.subtitle || e.description).map((e) => h('div', { class: 'doc-entry' },
        h('div', { class: 'doc-entry-top' },
          h('div', {}, h('div', { class: 'doc-et' }, e.title), (e.subtitle || e.location) && h('div', { class: 'doc-es' }, [e.subtitle, e.location].filter(Boolean).join(' · '))),
          dateRange(e) && h('div', { class: 'doc-date' }, dateRange(e))),
        docDesc(e.description)));
  if (!body || (Array.isArray(body) && !body.length)) return null;
  return h('section', { class: 'doc-sec' }, h('h2', { class: 'doc-h' }, s.title), body);
}
function renderCvDoc(data) {
  const d = data.design;
  const visible = data.sections.filter((s) => !s.hidden);
  // Two columns only when something is assigned to the sidebar; otherwise an empty strip would waste the page.
  const side = d.layout !== 'single' ? visible.filter((s) => s.side ?? s.kind === 'tags') : [];
  const two = side.length > 0;
  const main = visible.filter((s) => !side.includes(s));
  return h('article', { class: `doc cv layout-${d.layout} head-${d.headerAlign} hs-${d.heading} dp-${d.datePos}`, vars: docVars(d) },
    docHeader(data.personal),
    two ? h('div', { class: 'doc-cols' }, h('aside', { class: 'doc-side' }, side.map(docSection)), h('div', { class: 'doc-main' }, main.map(docSection)))
      : main.map(docSection));
}

// Scale the A4 page to the stage width; page-break guides every 297mm.
function fitPage(stage, page) {
  const pagePx = 793.7; // 210mm at 96dpi
  page.style.zoom = Math.min(1, (stage.clientWidth - 48) / pagePx);
}
function refreshPreview(now = false) {
  clearTimeout(cv.previewTimer);
  const run = () => {
    if (!cv.doc) return;
    const page = renderCvDoc(cv.doc.data);
    $('#cvPage').replaceChildren(page);
    fitPage($('#cvStage'), page);
  };
  if (now) run(); else cv.previewTimer = setTimeout(run, 120);
}

// ---- persistence
function setSaved(text) { $('#cvSaved').textContent = text; }
function changed({ structure = false } = {}) {
  if (structure) renderCvEditor();
  refreshPreview();
  setSaved('Saving…');
  clearTimeout(cv.saveTimer);
  cv.saveTimer = setTimeout(guard(async () => {
    cv.doc.id = await api.saveDoc({ id: cv.doc.id, kind: 'cv', name: cv.doc.name, data: cv.doc.data });
    try { localStorage.setItem('jp.cv', cv.doc.id); } catch { /* per-device convenience only */ }
    setSaved('Saved');
  }), 600);
}

async function loadCvBuilder() {
  const list = await api.listDocs('cv');
  let lastId = null;
  try { lastId = localStorage.getItem('jp.cv'); } catch { /* ignore */ }
  const pick = list.find((d) => d.id === (cv.doc?.id || lastId)) || list[0];
  if (pick && pick.id !== cv.doc?.id) cv.doc = await api.getDoc(pick.id);
  if (!pick) cv.doc = null;
  renderCvPicker(list);
  renderCvEditor();
  refreshPreview(true);
  $('#cvStage').scrollTop = 0;
  $('#cvbuilder .studio-editor').scrollTop = 0;
}
function renderCvPicker(list) {
  const sel = $('#cvPick');
  sel.replaceChildren(...list.map((d) => h('option', { value: d.id }, d.name)));
  sel.value = cv.doc?.id || '';
  sel.disabled = !list.length;
  ['#cvDup', '#cvName', '#cvDelete', '#cvPdf'].forEach((s) => ($(s).disabled = !cv.doc));
  $('#cvName').value = cv.doc?.name || '';
}
async function openNewCv(name, data) {
  cv.doc = { id: null, name, data };
  cv.doc.id = await api.saveDoc({ kind: 'cv', name, data });
  try { localStorage.setItem('jp.cv', cv.doc.id); } catch { /* ignore */ }
  await loadCvBuilder();
  setSaved('Saved');
}

// ---- editor
const field = (label, value, oninput, attrs = {}) => h('label', { class: 'f' }, h('span', {}, label), h('input', { value: value ?? '', oninput, ...attrs }));
const area = (label, value, oninput, rows = 4, hint) => h('label', { class: 'f' }, h('span', {}, label, hint && h('em', {}, hint)), Object.assign(h('textarea', { rows, oninput }), { value: value || '' }));

function renderCvEditor() {
  document.querySelectorAll('#cvbuilder .seg-tab').forEach((b) => b.classList.toggle('on', b.dataset.cvtab === cv.tab));
  if (!cv.doc) {
    $('#cvEditor').replaceChildren(emptyState('file', 'Build your CV', 'Start from the CV file you already have, or from your JobPilot profile.',
      h('div', { class: 'row-actions' }, btn('Import my CV', 'upload', () => $('#cvImport').click(), 'btn btn-primary'), btn('Start from profile', 'plus', () => $('#cvNew').click()))));
    return;
  }
  $('#cvEditor').replaceChildren(...(cv.tab === 'content' ? contentEditor() : designEditor()));
}

function contentEditor() {
  const data = cv.doc.data, p = data.personal;
  const set = (k) => (e) => { p[k] = e.target.value; changed(); };
  const personal = h('div', { class: 'ed-card' }, h('div', { class: 'ed-card-head' }, icon('user'), h('strong', {}, 'Personal details')),
    h('div', { class: 'grid-2' }, field('Full name', p.name, set('name')), field('Job title', p.title, set('title')),
      field('Email', p.email, set('email'), { type: 'email' }), field('Phone', p.phone, set('phone')),
      field('Location', p.location, set('location')),
      field('Links', (p.links || []).join(' · '), (e) => { p.links = e.target.value.split('·').map((x) => x.trim()).filter(Boolean); changed(); }, { placeholder: 'linkedin.com/in/you · orcid.org/…' })));
  const sections = data.sections.map((s, i) => sectionCard(s, i));
  const used = new Set(data.sections.map((s) => s.type));
  const add = h('div', { class: 'ed-add' }, h('span', { class: 'help' }, 'Add section'),
    Object.entries(PRESETS).filter(([t]) => t === 'custom' || !used.has(t)).map(([t, [title, kind]]) => h('button', { type: 'button', class: 'chip-btn', onclick: () => {
      data.sections.push({ id: newId(), type: t, title, kind, hidden: false, text: '', items: kind === 'entries' ? [blankEntry()] : [] });
      changed({ structure: true });
    } }, icon('plus'), title)));
  return [personal, ...sections, add];
}

function moveIn(arr, i, j) { if (j < 0 || j >= arr.length) return; const [x] = arr.splice(i, 1); arr.splice(j, 0, x); }

function sectionCard(s, i) {
  const data = cv.doc.data;
  const collapsed = cv.collapsed.has(s.id);
  const two = data.design.layout !== 'single';
  const card = h('div', { class: `ed-card sec ${s.hidden ? 'is-hidden' : ''}`, 'data-i': i,
    ondragover: (e) => { e.preventDefault(); card.classList.add('drop'); }, ondragleave: () => card.classList.remove('drop'),
    ondrop: (e) => { e.preventDefault(); card.classList.remove('drop'); const from = +e.dataTransfer.getData('text/cv-section'); if (!Number.isNaN(from) && from !== i) { moveIn(data.sections, from, i); changed({ structure: true }); } } },
  h('div', { class: 'ed-card-head' },
    h('span', { class: 'drag', draggable: 'true', title: 'Drag to reorder', ondragstart: (e) => e.dataTransfer.setData('text/cv-section', String(i)) }, '⋮⋮'),
    h('input', { class: 'sec-title', value: s.title, 'aria-label': 'Section title', oninput: (e) => { s.title = e.target.value; changed(); } }),
    two ? h('button', { type: 'button', class: `mini ${s.side ?? s.kind === 'tags' ? 'on' : ''}`, title: 'Show in the sidebar column', onclick: () => { s.side = !(s.side ?? s.kind === 'tags'); changed({ structure: true }); } }, 'Sidebar') : null,
    iconBtn('eye-off', s.hidden ? 'Show section' : 'Hide section', () => { s.hidden = !s.hidden; changed({ structure: true }); }, s.hidden ? 'on' : ''),
    iconBtn('left', 'Move up', () => { moveIn(data.sections, i, i - 1); changed({ structure: true }); }, 'rot-up'),
    iconBtn('right', 'Move down', () => { moveIn(data.sections, i, i + 1); changed({ structure: true }); }, 'rot-down'),
    iconBtn('x', 'Delete section', () => { if (confirm(`Delete “${s.title}”?`)) { data.sections.splice(i, 1); changed({ structure: true }); } }, 'danger'),
    iconBtn('right', collapsed ? 'Expand' : 'Collapse', () => { collapsed ? cv.collapsed.delete(s.id) : cv.collapsed.add(s.id); renderCvEditor(); }, collapsed ? '' : 'rot-down')));
  if (collapsed) return card;
  if (s.kind === 'text') card.append(area('', s.text, (e) => { s.text = e.target.value; changed(); }, 5));
  else if (s.kind === 'tags') card.append(tagsEditor(s));
  else card.append(entriesEditor(s));
  return card;
}

function tagsEditor(s) {
  return h('div', { class: 'tags-ed' },
    s.items.map((t, j) => h('div', { class: 'tag-ed' },
      h('input', { value: t.name, placeholder: 'Skill', 'aria-label': 'Name', oninput: (e) => { t.name = e.target.value; changed(); } }),
      (() => { const sel = h('select', { 'aria-label': 'Level', onchange: (e) => { t.level = +e.target.value || ''; changed(); } },
        h('option', { value: '' }, 'No level'), [1, 2, 3, 4, 5].map((n) => h('option', { value: n }, `${'●'.repeat(n)}${'○'.repeat(5 - n)}`))); sel.value = t.level || ''; return sel; })(),
      iconBtn('x', 'Remove', () => { s.items.splice(j, 1); changed({ structure: true }); }))),
    btn('Add', 'plus', () => { s.items.push({ id: newId(), name: '', level: '' }); changed({ structure: true }); }, 'btn btn-sm'));
}

function entriesEditor(s) {
  const [, , l1 = 'Title', l2 = 'Subtitle'] = PRESETS[s.type] || [];
  return h('div', { class: 'entries-ed' },
    s.items.map((e, j) => {
      const set = (k) => (ev) => { e[k] = ev.target.value; changed(); };
      return h('div', { class: 'entry-ed' },
        h('div', { class: 'entry-ed-head' }, h('strong', {}, e.title || e.subtitle || 'New entry'), h('span', { class: 'help' }, dateRange(e)),
          iconBtn('left', 'Move up', () => { moveIn(s.items, j, j - 1); changed({ structure: true }); }, 'rot-up'),
          iconBtn('right', 'Move down', () => { moveIn(s.items, j, j + 1); changed({ structure: true }); }, 'rot-down'),
          iconBtn('x', 'Delete entry', () => { s.items.splice(j, 1); changed({ structure: true }); }, 'danger')),
        h('div', { class: 'grid-2' }, field(l1, e.title, set('title')), field(l2, e.subtitle, set('subtitle')),
          field('Location', e.location, set('location')),
          h('div', { class: 'grid-2 tight' }, field('Start', e.start, set('start'), { placeholder: '01/2025' }), field('End', e.end, set('end'), { placeholder: 'Present' }))),
        area('Description', e.description, set('description'), 4, 'start lines with • for bullets'));
    }),
    btn('Add entry', 'plus', () => { s.items.push(blankEntry()); changed({ structure: true }); }, 'btn btn-sm'));
}

function designEditor() {
  const d = cv.doc.data.design;
  const set = (k, v, structure = false) => { d[k] = v; changed({ structure }); };
  const seg = (k, opts) => h('div', { class: 'segmented' }, opts.map(([v, label]) => h('button', { type: 'button', class: d[k] === v ? 'on' : '', onclick: () => set(k, v, true) }, label)));
  const slider = (k, label, min, max, step, unit) => h('label', { class: 'f slider' }, h('span', {}, label, h('b', {}, `${d[k]}${unit}`)),
    h('input', { type: 'range', min, max, step, value: d[k], oninput: (e) => { d[k] = +e.target.value; e.target.previousSibling.lastChild.textContent = `${d[k]}${unit}`; changed(); } }));
  return [
    h('div', { class: 'ed-card' }, h('div', { class: 'ed-card-head' }, h('strong', {}, 'Templates')),
      h('div', { class: 'tpl-grid' }, Object.entries(TEMPLATES).map(([k, t]) => h('button', { type: 'button', class: `tpl ${d.template === k ? 'on' : ''}`, onclick: () => {
        Object.assign(d, { ...t, template: k }); delete d.label; changed({ structure: true });
      } }, h('span', { class: `tpl-thumb tpl-${t.layout}`, vars: { a: t.accent } }, h('i'), h('i'), h('i')), t.label)))),
    h('div', { class: 'ed-card' }, h('div', { class: 'ed-card-head' }, h('strong', {}, 'Layout')),
      h('div', { class: 'f' }, h('span', {}, 'Columns'), seg('layout', [['single', 'One column'], ['left', 'Sidebar left'], ['right', 'Sidebar right']])),
      h('div', { class: 'f' }, h('span', {}, 'Header'), seg('headerAlign', [['left', 'Left'], ['center', 'Centered']])),
      h('div', { class: 'f' }, h('span', {}, 'Dates'), seg('datePos', [['right', 'Right of title'], ['below', 'Below title']]))),
    h('div', { class: 'ed-card' }, h('div', { class: 'ed-card-head' }, h('strong', {}, 'Style')),
      h('div', { class: 'f' }, h('span', {}, 'Section headings'), seg('heading', [['underline', 'Underline'], ['box', 'Box'], ['bar', 'Rule'], ['plain', 'Small caps']])),
      h('div', { class: 'f' }, h('span', {}, 'Accent colour'), h('div', { class: 'swatches' },
        SWATCHES.map((c) => h('button', { type: 'button', class: `sw-btn ${d.accent === c ? 'on' : ''}`, vars: { c }, 'aria-label': `Accent ${c}`, onclick: () => set('accent', c, true) })),
        h('input', { type: 'color', value: d.accent, 'aria-label': 'Custom accent colour', oninput: (e) => set('accent', e.target.value) }))),
      h('label', { class: 'f' }, h('span', {}, 'Font'), (() => { const sel = h('select', { onchange: (e) => set('font', e.target.value) },
        FONTS.map((f) => h('option', { value: f }, f))); sel.value = d.font; return sel; })())),
    h('div', { class: 'ed-card' }, h('div', { class: 'ed-card-head' }, h('strong', {}, 'Spacing')),
      slider('size', 'Font size', 8.5, 12.5, 0.5, 'pt'), slider('lineHeight', 'Line height', 1.1, 1.7, 0.05, ''),
      slider('margin', 'Page margins', 8, 25, 1, 'mm'), slider('spacing', 'Section spacing', 4, 20, 1, 'pt')),
  ];
}

// ---- toolbar
document.querySelectorAll('#cvbuilder .seg-tab').forEach((b) => b.addEventListener('click', () => { cv.tab = b.dataset.cvtab; renderCvEditor(); }));
$('#cvPick').onchange = guard(async (e) => { cv.doc = await api.getDoc(e.target.value); try { localStorage.setItem('jp.cv', cv.doc.id); } catch { /* ignore */ } renderCvEditor(); refreshPreview(true); });
$('#cvNew').onclick = guard(async () => openNewCv('My CV', await api.newCv()));
$('#cvImport').onclick = guard(async () => {
  const r = await api.importCv();
  if (!r) return;
  await openNewCv(r.name, r.data);
  toast(`Imported ${r.data.sections.length} sections. Check each one: imports are a starting point.`, 'success');
});
$('#cvDup').onclick = guard(async () => openNewCv(`${cv.doc.name} (copy)`, structuredClone(cv.doc.data)));
// Inline rename (Electron has no window.prompt): save as you type, refresh the picker when you leave the field.
$('#cvName').oninput = (e) => { if (cv.doc) { cv.doc.name = e.target.value.slice(0, 80); changed(); } };
$('#cvName').onblur = guard(async () => { if (cv.doc) renderCvPicker(await api.listDocs('cv')); });
$('#cvDelete').onclick = guard(async () => {
  if (!confirm(`Delete “${cv.doc.name}”? This can't be undone.`)) return;
  await api.deleteDoc(cv.doc.id);
  cv.doc = null;
  try { localStorage.removeItem('jp.cv'); } catch { /* ignore */ }
  await loadCvBuilder();
});
// PDF: the preview's DOM (text escaped), plus the page size and margins for print.
function pdfHtml(page, marginMm) {
  return `<style>@page { size: A4; margin: ${Number(marginMm) || 16}mm; }</style>${page.outerHTML}`;
}
$('#cvPdf').onclick = guard(async () => {
  const page = renderCvDoc(cv.doc.data);
  const out = await api.exportPdf({ html: pdfHtml(page, cv.doc.data.design.margin), name: cv.doc.name });
  if (out) toast(`Saved ${out}`, 'success');
});
addEventListener('resize', () => { const page = $('#cvPage .doc'); if (page && !$('#cvbuilder').hidden) fitPage($('#cvStage'), page); });
