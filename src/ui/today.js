// Today: a briefing, not a list. What changed since you last looked and what to do next.

// "Since you last looked" = since you last left this page. localStorage is a per-device convenience; failure is harmless.
const LAST_SEEN = 'jp.lastSeen';
const lastSeen = () => { try { return localStorage.getItem(LAST_SEEN); } catch { return null; } };
function leaveToday() { try { localStorage.setItem(LAST_SEEN, new Date().toISOString()); } catch { /* private storage off */ } }

// Shared hover tooltip for charts and compact marks.
function tipOn(el, text) {
  const tip = $('#tip');
  el.addEventListener('mouseenter', () => { tip.textContent = text; tip.hidden = false; });
  el.addEventListener('mousemove', (e) => { tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 34}px`; });
  el.addEventListener('mouseleave', () => (tip.hidden = true));
  return el;
}

// Column sparkline of matches per day (single series: the title names it, no legend).
function pulseChart(perDay, { height = 56, barW = 10, gap = 4 } = {}) {
  const max = Math.max(1, ...perDay.map((d) => d.n));
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const w = perDay.length * (barW + gap) - gap;
  svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', height);
  svg.setAttribute('class', 'spark');
  perDay.forEach((d, i) => {
    const hgt = d.n ? Math.max(4, (d.n / max) * (height - 4)) : 2;
    const g = document.createElementNS(svgNS, 'g');
    const hit = document.createElementNS(svgNS, 'rect'); // hit target taller than the mark
    Object.entries({ x: i * (barW + gap) - gap / 2, y: 0, width: barW + gap, height, fill: 'transparent' }).forEach(([k, v]) => hit.setAttribute(k, v));
    const bar = document.createElementNS(svgNS, 'rect');
    Object.entries({ x: i * (barW + gap), y: height - hgt, width: barW, height: hgt, rx: 3, class: d.n ? 'spark-bar' : 'spark-zero' }).forEach(([k, v]) => bar.setAttribute(k, v));
    g.append(hit, bar);
    const day = new Date(`${d.date}T00:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    tipOn(g, `${day}: ${d.n} new match${d.n === 1 ? '' : 'es'}`);
    svg.append(g);
  });
  return svg;
}

const greet = (hour) => (hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /(ch|sh|s|x)$/.test(word) ? 'es' : 's'}`;

async function loadToday() {
  const [{ profile: p }, b, ins] = await Promise.all([api.getProfile(), api.briefing(lastSeen()), api.insights()]);
  const now = new Date();
  $('#todayDate').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  $('#greeting').textContent = `${greet(now.getHours())}${p.name ? `, ${p.name.split(' ')[0]}` : ''}.`;
  const parts = [lastSeen() && b.newSince ? `${plural(b.newSince, 'new match')} since you last looked` : null,
    b.toReview ? `${b.toReview} waiting for review` : null,
    b.followUps.length ? `${plural(b.followUps.length, 'follow-up')} due` : null,
    b.interviews.length ? `${plural(b.interviews.length, 'interview')} in progress` : null].filter(Boolean);
  $('#todaySummary').textContent = parts.length ? `${parts.join(' · ')}.` : 'You’re all caught up. New matches arrive every 30 minutes.';
  $('#todayPulse').replaceChildren(h('div', { class: 'pulse-label' }, 'New matches · 14 days'), pulseChart(ins.perDay));

  const jobLine = (j, note) => h('li', { class: 'mini-row', tabindex: '0', onclick: () => openJob(j.id), onkeydown: (e) => e.key === 'Enter' && openJob(j.id) },
    avatar(j.company || j.title, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'strong clip' }, j.title), h('div', { class: 'help clip' }, [j.company, note].filter(Boolean).join(' · '))),
    icon('arrow-right', 'go'));

  $('#todayActions').replaceChildren(
    // The primary action: a stack of cards that invites you to start reviewing.
    h('button', { class: `action action-review ${b.toReview ? '' : 'done'}`, type: 'button', onclick: () => show('review') },
      h('div', { class: 'stack', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      h('div', {},
        h('div', { class: 'action-kicker' }, b.toReview ? 'Start here' : 'Inbox zero'),
        h('div', { class: 'action-title' }, b.toReview ? `Review ${plural(b.toReview, 'match')}` : 'Nothing to review'),
        h('div', { class: 'action-sub' }, b.toReview ? 'Flick through them one at a time: save the good ones, pass on the rest.' : 'Every match has a decision. Nice.')),
      h('span', { class: 'action-go' }, icon('arrow-right'))),
    h('div', { class: 'action' },
      h('div', { class: 'action-head' }, icon('flag'), 'Follow up', h('span', { class: 'count' }, b.followUps.length)),
      b.followUps.length ? h('ul', { class: 'mini-list' }, b.followUps.slice(0, 3).map((j) => jobLine(j, `applied ${j.days} days ago`)))
        : h('p', { class: 'help' }, 'Nothing due. Jobs you applied to 7+ days ago without a reply show up here.')),
    h('div', { class: 'action' },
      h('div', { class: 'action-head' }, icon('users'), 'Interviews', h('span', { class: 'count' }, b.interviews.length)),
      b.interviews.length ? h('ul', { class: 'mini-list' }, b.interviews.slice(0, 3).map((j) => jobLine(j, 'interview')))
        : h('p', { class: 'help' }, 'Move a job to Interview on the My jobs board and it appears here.')));

  $('#todayFits').replaceChildren(...(b.freshFits.length ? b.freshFits.map((j) => h('button', { class: 'fit-card', type: 'button', onclick: () => openJob(j.id) },
    h('div', { class: 'fit-top' }, avatar(j.company || j.title), ring(j.score)),
    h('div', { class: 'fit-title' }, j.title),
    h('div', { class: 'help clip' }, [j.company, j.location].filter(Boolean).join(' · ')),
    j.salary ? h('span', { class: 'chip accent' }, icon('money'), j.salary) : h('span', { class: 'chip' }, types(j)[0] || j.source)))
    : [h('div', { class: 'fit-empty' }, emptyState('target', 'No fresh strong fits', 'Strong CV fits found in the last 3 days appear here.'))]));

  const stats = await api.stats();
  const flow = [['Saved', stats.saved, 'saved'], ['Applied', stats.applied, 'applied'], ['Interview', stats.interview, 'interview'], ['Offer', stats.offer, 'offer']];
  $('#todayPipeline').replaceChildren(...flow.map(([label, n, cls]) => h('button', { class: `flow-step ${cls}`, type: 'button', onclick: () => show('myjobs') },
    h('span', { class: 'flow-n' }, n), h('span', { class: 'flow-label' }, label))));
}
