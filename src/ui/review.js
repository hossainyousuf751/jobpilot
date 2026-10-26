// Review deck: one decision per job. Drag or arrow keys: → save, ← pass, ↓ hide, ↑ open; Ctrl+Z undo.
const deck = { queue: [], done: 0, saved: 0, history: [], busy: false };
const THRESHOLD = 110; // px of drag that commits a decision

async function loadReview() {
  deck.queue = await api.reviewQueue();
  deck.done = 0;
  deck.saved = 0;
  deck.history = [];
  renderDeck();
}

function renderDeck() {
  const total = deck.done + deck.queue.length;
  $('#reviewProgressText').textContent = total ? `${deck.done} of ${total} reviewed` : '';
  $('#reviewMeter').style.width = `${total ? (100 * deck.done) / total : 100}%`;
  $('#deckUndo').disabled = !deck.history.length;
  const top = deck.queue[0];
  ['#deckPass', '#deckSave', '#deckOpen'].forEach((s) => ($(s).disabled = !top));
  if (!top) {
    $('#deck').replaceChildren(h('div', { class: 'deck-done' },
      h('div', { class: 'done-orb' }, icon('check')),
      h('h2', {}, 'All caught up'),
      h('p', { class: 'muted' }, deck.done ? `You reviewed ${plural(deck.done, 'job')} and saved ${deck.saved}.` : 'Every match already has a decision. New ones arrive with the next refresh.'),
      h('div', { class: 'deck-done-actions' }, btn('My jobs', 'briefcase', () => show('myjobs'), 'btn btn-primary'), btn('Browse matches', 'target', () => show('feed')))));
    return;
  }
  // Two cards peek out behind the top one, so the stack reads as a pile you work through.
  const behind = deck.queue.slice(1, 3).map((j, i) => h('div', { class: `deck-card behind behind-${i + 1}`, 'aria-hidden': 'true' },
    h('div', { class: 'deck-head' }, avatar(j.company || j.title, 'lg'), h('div', { class: 'grow' }, h('h2', {}, j.title)))));
  const card = deckCard(top);
  $('#deck').replaceChildren(...behind.reverse(), card);
  enableDrag(card);
}

function deckCard(j) {
  const r = j.reasons, parts = r.parts || {};
  const desc = h('div', { class: 'deck-desc' }, h('span', { class: 'help' }, 'Loading description…'));
  api.getJob(j.id).then((full) => desc.replaceChildren(full?.description || 'The source sent no description. Press ↑ to open the posting.'));
  return h('article', { class: 'deck-card top', tabindex: '0', 'aria-label': `${j.title} at ${j.company || 'unknown company'}, score ${j.score}` },
    h('div', { class: 'stamp stamp-save' }, 'Save'), h('div', { class: 'stamp stamp-pass' }, 'Pass'), h('div', { class: 'stamp stamp-hide' }, 'Hide'),
    h('div', { class: 'deck-head' }, avatar(j.company || j.title, 'lg'),
      h('div', { class: 'grow' }, h('h2', {}, j.title), h('div', { class: 'detail-company' }, [j.company, j.location].filter(Boolean).join(' · '))),
      ring(j.score, !!j.eligible, 'lg')),
    h('div', { class: 'chips' },
      j.salary && h('span', { class: 'chip accent' }, icon('money'), j.salary),
      types(j).map((t) => h('span', { class: 'chip' }, t)),
      j.remote ? h('span', { class: 'chip' }, 'Remote') : null,
      h('span', { class: 'chip' }, icon('clock'), posted(j)),
      h('span', { class: 'chip' }, j.also?.length ? `${j.source} +${j.also.length}` : j.source)),
    r.notes.filter((n) => n !== 'Strong CV fit').map((n) => h('div', { class: `callout ${noteClass(n)}` }, icon(noteClass(n) === 'ok' ? 'check' : 'info'), n)),
    h('div', { class: 'deck-fit' },
      scoreBars(parts),
      h('div', { class: 'chips' }, r.notes.includes('Strong CV fit') && h('span', { class: 'chip ok' }, icon('check'), 'Strong CV fit'),
        r.matched.slice(0, 6).map((s) => h('span', { class: 'chip ok' }, s)), r.missing.slice(0, 3).map((s) => h('span', { class: 'chip ghost' }, s)))),
    desc);
}

// Pointer drag with tilt; the stamp for the direction fades in as you pull.
function enableDrag(card) {
  let x0 = 0, y0 = 0, dx = 0, dy = 0, dragging = false;
  const stamps = { save: card.querySelector('.stamp-save'), pass: card.querySelector('.stamp-pass'), hide: card.querySelector('.stamp-hide') };
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, a, .deck-desc')) return;
    dragging = true; x0 = e.clientX; y0 = e.clientY;
    card.setPointerCapture(e.pointerId);
    card.classList.add('dragging');
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    stamps.save.style.opacity = Math.max(0, Math.min(1, dx / THRESHOLD));
    stamps.pass.style.opacity = Math.max(0, Math.min(1, -dx / THRESHOLD));
    stamps.hide.style.opacity = Math.max(0, Math.min(1, (dy - Math.abs(dx)) / THRESHOLD));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    if (dx > THRESHOLD) decide('save');
    else if (dx < -THRESHOLD) decide('pass');
    else if (dy > THRESHOLD && dy > Math.abs(dx)) decide('hide');
    else { card.style.transform = ''; Object.values(stamps).forEach((s) => (s.style.opacity = 0)); } // spring back (CSS transition)
    dx = dy = 0;
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  card.focus({ preventScroll: true });
}

async function decide(action) {
  const j = deck.queue[0];
  if (!j || deck.busy) return;
  if (action === 'open') return browse(j.url);
  deck.busy = true;
  const card = $('#deck .deck-card.top');
  card?.querySelector(`.stamp-${action}`)?.style.setProperty('opacity', 1);
  card?.classList.add(`fly-${action}`);
  try {
    await new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240));
    if (action === 'save') { await api.setJobStatus(j.id, 'saved'); deck.saved++; }
    else if (action === 'hide') await api.setJobStatus(j.id, 'hidden');
    else await api.markReviewed(j.id);
    deck.history.push({ job: j, action });
    deck.queue.shift();
    deck.done++;
    renderDeck();
    loadStats();
  } catch (e) {
    card?.classList.remove(`fly-${action}`);
    toast(String(e.message || e), 'error');
  } finally { deck.busy = false; }
}

async function undo() {
  const last = deck.history.pop();
  if (!last) return;
  await api.undoReview(last.job.id);
  deck.queue.unshift(last.job);
  deck.done--;
  if (last.action === 'save') deck.saved--;
  renderDeck();
  loadStats();
  toast(`Undid ${last.action} on “${last.job.title}”`);
}

$('#deckPass').onclick = () => decide('pass');
$('#deckSave').onclick = () => decide('save');
$('#deckOpen').onclick = () => decide('open');
$('#deckUndo').onclick = guard(undo);
document.addEventListener('keydown', (e) => {
  if ($('#review').hidden || $('#palette').open || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  const map = { ArrowRight: 'save', ArrowLeft: 'pass', ArrowDown: 'hide', ArrowUp: 'open' };
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); guard(undo)(); }
  else if (map[e.key]) { e.preventDefault(); decide(map[e.key]); }
});
