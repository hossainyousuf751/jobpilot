// Insights: your market from your own matches. Skill demand vs your skills, salary bands, daily flow, sources.
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function panel(title, sub, body, cls = '') {
  return h('section', { class: `insight ${cls}` }, h('header', {}, h('h2', {}, title), sub && h('p', { class: 'help' }, sub)), body);
}

// Horizontal bars; identity (have/gap) is carried by a legend, an icon and the text, never colour alone.
function skillChart(skills, total) {
  const max = Math.max(1, ...skills.map((s) => s.n));
  return h('div', {},
    h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'sw have' }), 'You have it'), h('span', {}, h('i', { class: 'sw gap' }), 'Gap to close')),
    h('ul', { class: 'hbars' }, skills.map((s) => tipOn(h('li', { class: 'hbar' },
      h('span', { class: 'hbar-label' }, s.have ? icon('check', 'have-i') : icon('plus', 'gap-i'), s.skill),
      h('span', { class: 'hbar-track' }, h('span', { class: `hbar-fill ${s.have ? 'have' : 'gap'}`, vars: { p: (100 * s.n) / max } })),
      h('span', { class: 'hbar-n' }, s.n)),
    `${s.skill}: asked for in ${s.n} of ${total} matches · ${s.have ? 'on your CV' : 'not on your CV yet'}`))));
}

function salaryBands(bands) {
  if (!bands.length) return emptyState('money', 'No salaries yet', 'Bdjobs, Indeed and Bayt list salaries; they appear here as those jobs come in.');
  return h('ul', { class: 'bands' }, bands.map((b) => {
    const pos = b.max > b.min ? (100 * (b.median - b.min)) / (b.max - b.min) : 50;
    return tipOn(h('li', { class: 'band' },
      h('div', { class: 'band-head' }, h('span', { class: 'strong' }, `${b.currency} per ${b.period}`), h('span', { class: 'help' }, `${b.n} job${b.n === 1 ? '' : 's'}`)),
      h('div', { class: 'band-track' }, h('span', { class: 'band-median', vars: { p: pos } })),
      h('div', { class: 'band-scale' }, h('span', {}, fmt(b.min)), h('span', { class: 'strong' }, `median ${fmt(b.median)}`), h('span', {}, fmt(b.max)))),
    `${b.currency} ${fmt(b.min)} to ${fmt(b.max)} per ${b.period}; median ${fmt(b.median)} across ${b.n} jobs`);
  }));
}

function sourceBars(sources, total) {
  const max = Math.max(1, ...sources.map((s) => s.n));
  return h('ul', { class: 'hbars' }, sources.map((s) => tipOn(h('li', { class: 'hbar' },
    h('span', { class: 'hbar-label' }, s.source),
    h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', vars: { p: (100 * s.n) / max } })),
    h('span', { class: 'hbar-n' }, s.n)), `${s.source}: ${s.n} of ${total} matches (${Math.round((100 * s.n) / total)}%)`)));
}

// Score accuracy: how well scores agree with your own keep/drop decisions, measured on decisions held out from learning.
function accuracyPanel(cal, prior) {
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  if (!cal.active) {
    const need = Math.max(0, 20 - cal.n);
    return panel('Score accuracy', 'Scores learn your taste from your decisions in Review.', h('div', { class: 'calib' },
      h('div', { class: 'calib-meter' }, h('div', { class: 'meter' }, h('span', { vars: {}, style: `width:${Math.min(100, (100 * cal.n) / 20)}%` }))),
      h('p', {}, `${cal.n} of 20 decisions so far (${cal.pos} kept, ${cal.neg} passed or hidden; at least 5 of each needed).`),
      h('p', { class: 'help' }, need ? `Make ${need} more in Review; then JobPilot learns which metrics predict what you keep and reports how often its scores agree with you.`
        : 'Enough decisions: they need at least 5 kept and 5 dropped.'),
      btn('Review matches', 'layers', () => show('review'), 'btn btn-primary')));
  }
  const max = Math.max(...Object.values(cal.weights), ...Object.values(prior));
  return panel('Score accuracy', `Agreement with your decisions, measured on ${Math.floor(cal.n / 2)} of ${cal.n} decisions held out from learning.`, h('div', { class: 'calib' },
    h('div', { class: 'calib-auc' },
      h('div', {}, h('div', { class: 'kpi-value' }, pct(cal.aucLearned)), h('div', { class: 'help' }, 'learned weights')),
      h('div', {}, h('div', { class: 'kpi-value muted' }, pct(cal.aucPrior)), h('div', { class: 'help' }, 'default weights'))),
    h('p', { class: 'help' }, 'Chance that a job you kept outscores one you dropped. 50% is a coin flip; 100% is perfect.'),
    h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'sw have' }), 'Learned weight'), h('span', {}, h('i', { class: 'sw prior' }), 'Default')),
    h('ul', { class: 'hbars' }, Object.entries(METRIC_INFO).map(([k, [label]]) => tipOn(h('li', { class: 'hbar' },
      h('span', { class: 'hbar-label' }, label),
      h('span', { class: 'hbar-track dual' }, h('span', { class: 'hbar-fill have', vars: { p: (100 * cal.weights[k]) / max } }), h('span', { class: 'hbar-fill prior', vars: { p: (100 * prior[k]) / max } })),
      h('span', { class: 'hbar-n' }, Math.round(cal.weights[k]))), `${label}: learned weight ${cal.weights[k]}, default ${prior[k]}`)))));
}

async function loadInsights() {
  const [ins, stats] = await Promise.all([api.insights(), api.stats()]);
  if (!ins.total) {
    $('#insightGrid').replaceChildren(emptyState('chart', 'No matches to analyse yet', 'Insights appear once JobPilot has found jobs for your profile.'));
    return;
  }
  const weight = ins.skills.reduce((a, s) => a + s.n, 0) || 1;
  const coverage = Math.round((100 * ins.skills.filter((s) => s.have).reduce((a, s) => a + s.n, 0)) / weight);
  const gap = ins.skills.find((s) => !s.have);
  const pay = ins.salaries[0];
  const hero = (label, value, note) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), note && h('div', { class: 'help' }, note));
  const days = ins.perDay;
  $('#insightGrid').replaceChildren(
    h('div', { class: 'kpis span-all' },
      hero('Skill coverage', `${coverage}%`, 'of skill mentions in your matches are on your CV'),
      hero('Biggest gap', gap ? gap.skill : 'None', gap ? `asked for in ${gap.n} matches` : 'you cover every top skill'),
      hero('Typical pay', pay ? `${pay.currency} ${fmt(pay.median)}` : '—', pay ? `median per ${pay.period}, ${pay.n} jobs` : 'no salaries listed yet'),
      hero('Matches', ins.total, `${days.slice(-7).reduce((a, d) => a + d.n, 0)} found in the last 7 days`)),
    accuracyPanel(stats.calibration, stats.priorWeights),
    panel('Skills employers ask for', `Across your ${ins.total} matches. Close a gap and more jobs fit.`, skillChart(ins.skills, ins.total), 'span-2'),
    panel('New matches per day', 'Last 14 days, by the day JobPilot found them.',
      h('div', { class: 'pulse-lg' }, pulseChart(days, { height: 140, barW: 24, gap: 8 }),
        h('div', { class: 'axis' }, h('span', {}, new Date(`${days[0].date}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' })), h('span', {}, 'today')))),
    panel('Salary bands', 'Listed salaries in your matches; each currency on its own scale.', salaryBands(ins.salaries)),
    panel('Where your matches come from', null, sourceBars(ins.sources, ins.total)));
}
