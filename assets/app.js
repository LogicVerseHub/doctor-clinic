/* ── config ── */
const HOSPITAL = 'Arogya Care Hospitals'; // fictional name shown in the header
const DATA_URL = new URLSearchParams(location.search).get('data') || 'data/patient_visits.csv';
const MIN_N = 20;       // minimum feedback count before a ratio is used for comparison or insights
const LONG_WAIT = 45;   // minutes; waits above this count as "long"
const SENT_NAMES = ['Positive', 'Neutral', 'Negative'];
const AGE_GROUPS = ['0-14', '15-29', '30-44', '45-59', '60+'];
const SCHEMES = /insurance|ayushman|pm-jay|cghs|echs|esi|tpa/i; // payment modes paid by an insurer or government scheme
// The CSV has no topic column, so feedback topics are derived from keywords in the text.
// Order is priority: the first match wins.
const TOPICS = [
  ['Waiting time', /wait|queue|token|turn on time|registration/],
  ['Billing & insurance', /bill|charge|insurance|cashless|claim|refund|overcharg/],
  ['Doctor consultation', /doctor|consultation|diagnosis|explained|\bdr\./],
  ['Staff & nursing', /staff|nurs|reception|front desk/],
  ['Cleanliness & hygiene', /clean|hygien|washroom|dirty|dustbin/],
  ['Lab & pharmacy', /\blab\b|report|pharmacy|medicine|blood test|sample/],
];

/* ── util ── */
const $ = (s, r = document) => r.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fInt = n => Math.round(n).toLocaleString('en-IN');
const fDec = (n, d = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const fPct = (x, d = 1) => fDec(x * 100, d) + '%';
// Indian units: thousand (K), lakh (L), crore (Cr)
const fRs = n => n >= 1e7 ? '₹' + fDec(n / 1e7, 2) + ' Cr' : n >= 1e5 ? '₹' + fDec(n / 1e5, 2) + ' L' : n >= 1e3 ? '₹' + fDec(n / 1e3, 1) + 'K' : '₹' + fInt(n);
const fRsFull = n => '₹' + fInt(n);
const fMin = n => fInt(n) + ' min';
const fDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${+d} ${MN[+m - 1]} ${y}`; };
const div = (a, b) => b ? a / b : null;
const mShort = i => { const [y, m] = RAW.months[i].split('-'); return MN[+m - 1] + (m === '01' ? ' ’' + y.slice(2) : ''); };
const mLong = i => { const [y, m] = RAW.months[i].split('-'); return MN[+m - 1] + ' ' + y; };
const mRange = (a, b) => { const ya = RAW.months[a].slice(0, 4), yb = RAW.months[b].slice(0, 4); const sa = MN[+RAW.months[a].slice(5) - 1], sb = MN[+RAW.months[b].slice(5) - 1]; return ya === yb ? `${sa}–${sb} ${yb}` : `${sa} ${ya}–${sb} ${yb}`; };
const num = (v, d = 0) => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return v !== '' && v != null && Number.isFinite(n) ? n : d; };

/* ── data: CSV → rows ── */
function parseCSV(text) {
  const out = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') out.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); out.push(row); }
  const head = (out.shift() || []).map(h => h.trim().toLowerCase());
  return out.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
// accept YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY
function isoDate(s) {
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
function sentimentIndex(label, rating) {
  const s = String(label || '').toLowerCase();
  if (s.startsWith('pos')) return 0;
  if (s.startsWith('neu')) return 1;
  if (s.startsWith('neg')) return 2;
  return rating >= 4 ? 0 : rating === 3 ? 1 : 2;
}
const topicOf = text => { const t = text.toLowerCase(); const i = TOPICS.findIndex(([, re]) => re.test(t)); return i < 0 ? TOPICS.length : i; };
const ageGroup = a => a <= 14 ? 0 : a <= 29 ? 1 : a <= 44 ? 2 : a <= 59 ? 3 : 4;

let RAW, ROWS, NM, PERIODS;
const SENT = ['pos', 'neu', 'neg'];

function normalize(recs, source) {
  if (!recs.length) throw new Error('The CSV has no data rows.');
  for (const c of ['visit_date', 'department', 'total_amount']) if (!(c in recs[0])) throw new Error(`Missing required column "${c}".`);
  recs = recs.map(r => ({ ...r, visit_date: isoDate(r.visit_date) })).filter(r => r.visit_date);
  if (!recs.length) throw new Error('No row has a valid visit_date (YYYY-MM-DD or DD-MM-YYYY).');
  const uniq = k => [...new Set(recs.map(r => r[k] || 'Unknown'))].sort((a, b) => a.localeCompare(b));
  const L = { city: uniq('city'), dept: uniq('department'), issue: uniq('issue'), doc: uniq('doctor_name'), gender: uniq('gender'), vtype: uniq('visit_type'), pay: uniq('payment_mode') };
  const ix = {}; for (const k in L) ix[k] = new Map(L[k].map((v, i) => [v, i]));
  const g = (k, v) => ix[k].get(v || 'Unknown');

  const ms = recs.map(r => r.visit_date.slice(0, 7)).sort(), months = [];
  for (let [y, m] = ms[0].split('-').map(Number); ; m++) {
    if (m > 12) { m = 1; y++; }
    const k = `${y}-${String(m).padStart(2, '0')}`; months.push(k);
    if (k >= ms[ms.length - 1]) break;
  }
  const mIdx = new Map(months.map((k, i) => [k, i]));

  const rows = recs.map((r, i) => {
    const rating = r.satisfaction_rating !== '' && r.satisfaction_rating != null ? Math.max(1, Math.min(5, Math.round(num(r.satisfaction_rating, 3)))) : null;
    const text = r.feedback || '', age = num(r.age, -1);
    const fee = num(r.consultation_fee), tests = num(r.test_charges), meds = num(r.medicine_charges), proc = num(r.procedure_charges);
    return {
      id: r.visit_id || `#${i + 1}`, pid: r.patient_id || r.patient_name || `#${i + 1}`, name: r.patient_name || '', age,
      ag: r.age_group && AGE_GROUPS.includes(r.age_group) ? AGE_GROUPS.indexOf(r.age_group) : age >= 0 ? ageGroup(age) : -1,
      gender: g('gender', r.gender), city: g('city', r.city), state: r.state || '', dept: g('dept', r.department), issue: g('issue', r.issue), doc: g('doc', r.doctor_name),
      date: r.visit_date, m: mIdx.get(r.visit_date.slice(0, 7)), time: r.visit_time || '', vtype: g('vtype', r.visit_type),
      wait: r.wait_time_min === '' || r.wait_time_min == null ? null : num(r.wait_time_min), stay: num(r.length_of_stay_days),
      fee, tests, meds, proc, total: num(r.total_amount, fee + tests + meds + proc), pay: g('pay', r.payment_mode),
      fu: /^(y|yes|true|1)$/i.test(r.follow_up_needed || ''), fuDate: isoDate(r.follow_up_date),
      rating, sent: rating != null ? sentimentIndex(r.sentiment, rating) : -1, topik: rating != null && text ? topicOf(text) : rating != null ? TOPICS.length : -1, text,
    };
  });
  const topik = TOPICS.map(t => t[0]);
  if (rows.some(r => r.topik === TOPICS.length)) topik.push('Other');
  return { source, months, ...L, sent: SENT_NAMES, topik, rows, schemeIdx: new Set(L.pay.map((p, i) => SCHEMES.test(p) ? i : -1).filter(i => i >= 0)) };
}

/* ── state ── */
const state = { period: 0, dept: -1, city: -1, gender: -1, vtype: -1, metric: 'n', dim: 'dept', sort: { key: 'n', dir: -1 }, rvTab: 'all', q: '', page: 0 };
let cur = null;

function agg(rows) {
  const a = { n: 0, rev: 0, pats: new Set(), wN: 0, wSum: 0, fu: 0, rv: 0, rsum: 0, rate: [0, 0, 0, 0, 0], s: [0, 0, 0], longRv: 0, longSum: 0, shortRv: 0, shortSum: 0, longN: 0, scheme: 0 };
  for (const r of rows) {
    a.n++; a.rev += r.total; a.pats.add(r.pid); if (r.fu) a.fu++;
    if (RAW.schemeIdx.has(r.pay)) a.scheme += r.total;
    const long = r.wait != null && r.wait > LONG_WAIT;
    if (r.wait != null) { a.wN++; a.wSum += r.wait; if (long) a.longN++; }
    if (r.rating != null) {
      a.rv++; a.rsum += r.rating; a.rate[r.rating - 1]++; a.s[r.sent]++;
      if (long) { a.longRv++; a.longSum += r.rating; } else if (r.wait != null) { a.shortRv++; a.shortSum += r.rating; }
    }
  }
  return a;
}
const rating = a => div(a.rsum, a.rv), negShare = a => div(a.s[2], a.rv), posShare = a => div(a.s[0], a.rv), fuRate = a => div(a.fu, a.n), avgWait = a => div(a.wSum, a.wN);

function compute() {
  const P = PERIODS[state.period];
  const base = ROWS.filter(r => (state.dept < 0 || r.dept === state.dept) && (state.city < 0 || r.city === state.city) && (state.gender < 0 || r.gender === state.gender) && (state.vtype < 0 || r.vtype === state.vtype));
  const byMonth = Array.from({ length: NM }, () => []);
  for (const r of base) byMonth[r.m].push(r);
  const rows = base.filter(r => r.m >= P.a && r.m <= P.b);
  const span = (a, b) => agg(byMonth.slice(Math.max(0, a), b + 1).flat());
  cur = { P, rows, all: agg(rows), months: byMonth.map(agg), last3: span(P.b - 2, P.b), prev3: P.b - 5 >= 0 ? span(P.b - 5, P.b - 3) : null, first3: P.b - P.a >= 5 ? span(P.a, P.a + 2) : null };
}

/* ── tooltip ── */
const tip = $('#tip');
function showTip(html, e) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY - r.height - 12;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y < 8) y = e.clientY + 18;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.hidden = true; };
function bindTip(el, html, onIn, onOut) {
  el.addEventListener('mousemove', e => { showTip(typeof html === 'function' ? html() : html, e); onIn && onIn(); });
  el.addEventListener('mouseleave', () => { hideTip(); onOut && onOut(); });
}
const tipRow = (k, v) => `<div class="r"><span>${k}</span><b>${v}</b></div>`;

/* ── chart primitives ── */
function nice(max, n = 4) {
  if (!(max > 0)) return { step: 1, max: 1 };
  const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  return { step, max: Math.ceil(max / step - 1e-9) * step };
}
function frame(box, o) {
  box.innerHTML = '';
  const W = Math.max(260, box.clientWidth), H = o.h, m = o.m;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.aria || '' }, box);
  return { svg, W, H, m, iw: W - m.l - m.r, ih: H - m.t - m.b };
}
function yAxis(f, lo, hi, step, fmt) {
  const y = v => f.m.t + f.ih - (v - lo) / (hi - lo) * f.ih;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    S('line', { x1: f.m.l, x2: f.W - f.m.r, y1: y(v), y2: y(v), class: v === lo ? 'base' : 'gridl' }, f.svg);
    S('text', { x: f.m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, f.svg).textContent = fmt(v);
  }
  return y;
}
function barChart(box, items, o) {
  const f = frame(box, { h: o.h || 240, m: Object.assign({ l: 44, r: 8, t: 24, b: 28 }, o.m), aria: o.aria });
  const nc = nice(Math.max(...items.map(d => d.value)), o.ticks || 4);
  const y = yAxis(f, 0, nc.max, nc.step, o.yfmt || fInt);
  const band = f.iw / items.length, bw = Math.min(o.bw || 24, band * 0.62), skip = band < 34 && !o.noSkip ? 2 : 1;
  const hi = o.highlightMax ? items.reduce((b, d, i) => d.value > items[b].value ? i : b, 0) : -1;
  items.forEach((d, i) => {
    const cx = f.m.l + band * i + band / 2, x = cx - bw / 2, y0 = y(0), yt = y(d.value), r = Math.min(4, bw / 2, y0 - yt);
    const bar = S('path', { d: `M${x},${y0}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${y0}Z`, class: 'bar ' + (d.cls || '') + (i === hi ? ' hi' : '') }, f.svg);
    if (i % skip === 0) S('text', { x: cx, y: f.m.t + f.ih + 18, 'text-anchor': 'middle', class: 'tick' }, f.svg).textContent = d.label;
    if (i === hi || d.text) S('text', { x: cx, y: yt - 7, 'text-anchor': 'middle', class: 'vlabel' }, f.svg).textContent = d.text || (o.yfmtFull || o.yfmt || fInt)(d.value);
    const hit = S('rect', { x: f.m.l + band * i, y: f.m.t, width: band, height: f.ih, fill: 'transparent' }, f.svg);
    bindTip(hit, d.tip, () => bar.classList.add('on'), () => bar.classList.remove('on'));
  });
  if (o.xTitle) S('text', { x: f.m.l + f.iw / 2, y: f.H - 4, 'text-anchor': 'middle', class: 'tick' }, f.svg).textContent = o.xTitle;
}
function lineChart(box, pts, o) {
  const f = frame(box, { h: o.h || 240, m: { l: 48, r: 16, t: 24, b: 28 }, aria: o.aria });
  const vals = pts.map(p => p.value).filter(v => v != null);
  if (!vals.length) { box.innerHTML = '<div class="empty">No data for this selection yet.</div>'; return; }
  const y = yAxis(f, o.lo, o.hi, o.step, o.yfmt);
  const band = f.iw / pts.length, X = i => f.m.l + band * i + band / 2, skip = band < 34 ? 2 : 1;
  const live = pts.map((p, i) => ({ ...p, i })).filter(p => p.value != null);
  const path = live.map((p, k) => (k ? 'L' : 'M') + X(p.i) + ',' + y(p.value)).join('');
  if (live.length > 1) S('path', { d: `${path}L${X(live[live.length - 1].i)},${y(o.lo)}L${X(live[0].i)},${y(o.lo)}Z`, class: 'area' }, f.svg);
  S('path', { d: path, class: 'ln' }, f.svg);
  const cross = S('line', { y1: f.m.t, y2: f.m.t + f.ih, class: 'cross', visibility: 'hidden' }, f.svg);
  const hover = S('circle', { r: 5, class: 'dot', visibility: 'hidden' }, f.svg);
  const last = live[live.length - 1], ext = live.reduce((b, p) => p.value > b.value ? p : b, live[0]);
  for (const p of new Set([last, ext])) {
    S('circle', { cx: X(p.i), cy: y(p.value), r: 4, class: 'dot' }, f.svg);
    S('text', { x: Math.min(X(p.i), f.W - 22), y: y(p.value) - 10, 'text-anchor': 'middle', class: 'vlabel' }, f.svg).textContent = o.yfmtFull(p.value);
  }
  pts.forEach((p, i) => {
    if (i % skip === 0) S('text', { x: X(i), y: f.m.t + f.ih + 18, 'text-anchor': 'middle', class: 'tick' }, f.svg).textContent = p.label;
    const hit = S('rect', { x: f.m.l + band * i, y: f.m.t, width: band, height: f.ih, fill: 'transparent' }, f.svg);
    bindTip(hit, p.tip, () => {
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      if (p.value != null) { hover.setAttribute('cx', X(i)); hover.setAttribute('cy', y(p.value)); hover.setAttribute('visibility', 'visible'); }
    }, () => { cross.setAttribute('visibility', 'hidden'); hover.setAttribute('visibility', 'hidden'); });
  });
}
function sparkline(vals) {
  const v = vals.filter(x => x != null);
  if (v.length < 2) return '';
  const W = 120, H = 44, lo = Math.min(...v), hi = Math.max(...v), rng = hi - lo || 1;
  const pts = vals.map((x, i) => x == null ? null : [4 + i * (W - 10) / (vals.length - 1), 6 + (1 - (x - lo) / rng) * (H - 12)]).filter(Boolean);
  const [ex, ey] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}" fill="none" stroke="var(--axis)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></svg>`;
}
/* last 3 months vs the 3 before; kind: rel (%), pp (points), min (minutes). good = which direction is good */
function delta(c, p, kind, good = 1) {
  if (c == null || p == null || !cur.prev3) return '';
  const d = kind === 'rel' ? (p ? (c - p) / p : 0) : c - p;
  const txt = kind === 'rel' ? fDec(Math.abs(d) * 100, 1) + '%' : kind === 'pp' ? fDec(Math.abs(d) * 100, 1) + ' pp' : fDec(Math.abs(d), 1) + ' min';
  const flat = Math.abs(d) < (kind === 'min' ? 0.05 : 0.0005);
  return `<span class="delta ${flat ? 'flat' : d * good > 0 ? 'up' : 'down'}">${flat ? '■' : d > 0 ? '▲' : '▼'} ${txt}</span>`;
}
const DELTA_NOTE = 'last 3 mo vs prior 3 mo';
function stackBar(barId, legendId, counts, names, cls) {
  const total = counts.reduce((s, n) => s + n, 0);
  $(barId).innerHTML = counts.map((n, i) => n ? `<span class="${cls[i]}" style="flex:${n}"></span>` : '').join('');
  $(legendId).innerHTML = counts.map((n, i) => n ? `<span><i class="sw ${cls[i]}"></i>${esc(names[i])}<b>${total ? fPct(n / total, 0) : '–'}</b></span>` : '').join('');
}

/* ── render: summary ── */
const ICON = {
  rev: '<svg viewBox="0 0 18 18"><path d="M5 3.500h8M5 6.500h8M5 3.500c4 0 4 6 0 6h-.5L11 15"/></svg>',
  visit: '<svg viewBox="0 0 18 18"><circle cx="9" cy="6" r="3"/><path d="M3.500 15.500a5.500 5.500 0 0111 0"/></svg>',
  fu: '<svg viewBox="0 0 18 18"><rect x="2.500" y="3.500" width="13" height="12" rx="2"/><path d="M2.500 7.500h13M6 2v3M12 2v3M6.500 11.500l1.700 1.700 3.300-3.300"/></svg>',
  wait: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9.500" r="6"/><path d="M9 6.500v3l2 1.500M7 2h4"/></svg>',
};
function renderSummary() {
  const a = cur.all, P = cur.P, l = cur.last3, p = cur.prev3 || {};
  $('#h-rating').textContent = a.rv ? fDec(rating(a)) : '–';
  $('#h-meta').innerHTML = `<span>${fInt(a.rv)} feedback · ${fPct(div(a.rv, a.n) || 0, 0)} of visits rated</span>` + (cur.prev3 && l.rv && p.rv ? `<span class="chip">${rating(l) >= rating(p) ? '▲' : '▼'} ${fDec(Math.abs(rating(l) - rating(p)))} · last 3 mo</span>` : '');
  $('#h-stats').innerHTML = `<div><span>4–5 stars</span><b>${a.rv ? fPct((a.rate[3] + a.rate[4]) / a.rv, 0) : '–'}</b></div><div><span>1–2 stars</span><b>${a.rv ? fPct((a.rate[0] + a.rate[1]) / a.rv, 0) : '–'}</b></div>`;
  const mx = Math.max(1, ...a.rate);
  $('#h-dist').innerHTML = [5, 4, 3, 2, 1].map(s => `<div class="dist-row"><span>${s} ★</span><span class="track"><span class="fill" style="width:${a.rate[s - 1] / mx * 100}%"></span></span><span class="v">${fInt(a.rate[s - 1])} · ${a.rv ? fPct(a.rate[s - 1] / a.rv, 0) : '0%'}</span></div>`).join('');

  const ms = cur.months.slice(P.a, P.b + 1);
  const tiles = [
    { ico: 'rev', label: 'Revenue', val: fRs(a.rev), sub: `${a.n ? fRsFull(a.rev / a.n) : '–'} avg bill · ${a.rev ? fPct(a.scheme / a.rev, 0) : '–'} via insurance/schemes`, d: delta(l.rev, p.rev, 'rel'), sp: ms.map(m => m.rev) },
    { ico: 'visit', label: 'Patient visits', val: fInt(a.n), sub: `${fInt(a.pats.size)} unique patients`, d: delta(l.n, p.n, 'rel'), sp: ms.map(m => m.n) },
    { ico: 'fu', label: 'Follow-up needed', val: a.n ? fPct(fuRate(a)) : '–', sub: `${fInt(a.fu)} of ${fInt(a.n)} visits`, d: delta(fuRate(l), p.n ? fuRate(p) : null, 'pp'), sp: ms.map(fuRate) },
    { ico: 'wait', label: 'Average waiting time', val: a.wN ? fMin(avgWait(a)) : '–', sub: `${fInt(a.longN)} visits waited over ${LONG_WAIT} min`, d: delta(avgWait(l), p.wN ? avgWait(p) : null, 'min', -1), sp: ms.map(avgWait) },
  ];
  $('#kpis').innerHTML = tiles.map(t => `<div class="card kpi"><div class="kpi-top"><div class="kpi-ico">${ICON[t.ico]}</div><span>${t.label}</span></div><div><div class="kpi-val">${t.val}</div><div class="kpi-sub">${t.sub}</div>${t.d ? `<div class="kpi-row">${t.d}<span>${DELTA_NOTE}</span></div>` : ''}</div>${sparkline(t.sp)}</div>`).join('');
}

/* ── render: trend ── */
const METRICS = {
  n: { label: 'Visits', get: m => m.n, fmt: fInt, axis: fInt, big: c => fDec(c.all.n / (c.P.b - c.P.a + 1), 1), note: 'average visits per month' },
  rev: { label: 'Revenue', get: m => m.rev, fmt: fRs, axis: fRs, big: c => fRs(c.all.rev / (c.P.b - c.P.a + 1)), note: 'average revenue per month' },
  wait: { label: 'Wait time', line: true, get: avgWait, fmt: fMin, axis: v => fInt(v), big: c => c.all.wN ? fMin(avgWait(c.all)) : '–', note: 'average waiting time (minutes)' },
  rat: { label: 'Satisfaction', line: true, get: rating, fmt: v => fDec(v), axis: v => fDec(v, 1), big: c => c.all.rv ? fDec(rating(c.all)) : '–', note: 'average satisfaction rating (1–5)' },
  fu: { label: 'Follow-up %', line: true, get: fuRate, fmt: v => fPct(v), axis: v => fPct(v, 0), big: c => c.all.n ? fPct(fuRate(c.all)) : '–', note: 'share of visits needing a follow-up' },
};
function renderTrend() {
  const M = METRICS[state.metric], P = cur.P, idx = []; for (let i = P.a; i <= P.b; i++) idx.push(i);
  $('#trend-sub').textContent = `By visit month · ${mRange(P.a, P.b)}`;
  $('#trend-big').textContent = M.big(cur); $('#trend-note').textContent = M.note;
  const tipOf = i => { const m = cur.months[i]; return `<div class="t">${mLong(i)}</div>` + tipRow('Visits', fInt(m.n)) + tipRow('Revenue', fRs(m.rev)) + tipRow('Avg wait', m.wN ? fMin(avgWait(m)) : '–') + tipRow('Satisfaction', m.rv ? fDec(rating(m)) : '–') + tipRow('Follow-up', m.n ? fPct(fuRate(m)) : '–'); };
  const box = $('#trendChart');
  if (!cur.all.n) { box.innerHTML = '<div class="empty">No visits for this filter combination.</div>'; return; }
  if (!M.line) {
    barChart(box, idx.map(i => ({ label: mShort(i), value: M.get(cur.months[i]), tip: tipOf(i) })), { h: 244, ticks: 5, yfmt: M.axis, yfmtFull: M.fmt, highlightMax: true, bw: 24, m: { l: 58 }, aria: `${M.label} per month` });
  } else {
    const vals = idx.map(i => M.get(cur.months[i])), v = vals.filter(x => x != null);
    let lo = 0, hi, step;
    if (state.metric === 'rat') { lo = Math.max(1, Math.floor(Math.min(...v) * 2 - 0.5) / 2); hi = Math.min(5, Math.ceil(Math.max(...v) * 2 + 0.5) / 2); step = 0.5; if (hi <= lo) hi = lo + 0.5; }
    else { const nc = nice(Math.max(state.metric === 'fu' ? 0.05 : 1, ...v), 4); hi = nc.max; step = nc.step; }
    lineChart(box, idx.map((i, k) => ({ label: mShort(i), value: vals[k], tip: tipOf(i) })), { h: 244, lo, hi, step, yfmt: M.axis, yfmtFull: M.fmt, aria: `${M.label} per month` });
  }
}

/* ── render: sentiment + patient mix ── */
function renderMix() {
  const a = cur.all, svg = $('#donut'); svg.innerHTML = '';
  $('#sent-sub').textContent = `From ${fInt(a.rv)} patient feedback`;
  const r = 60, C = 2 * Math.PI * r, gap = 2; let off = 0;
  S('circle', { cx: 75, cy: 75, r, stroke: 'var(--surface-2)' }, svg);
  a.s.forEach((n, i) => {
    if (!n) return;
    const len = n / a.rv * C;
    const c = S('circle', { cx: 75, cy: 75, r, class: 's-' + SENT[i], 'stroke-dasharray': `${Math.max(0.5, len - gap)} ${C}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 75 75)' }, svg);
    bindTip(c, `<div class="t">${RAW.sent[i]}</div><div class="v">${fPct(n / a.rv)}</div>` + tipRow('Feedback', fInt(n)));
    off += len;
  });
  S('text', { x: 75, y: 76, 'text-anchor': 'middle', class: 'c1' }, svg).textContent = fInt(a.rv);
  S('text', { x: 75, y: 93, 'text-anchor': 'middle', class: 'c2' }, svg).textContent = 'feedback';
  $('#sent-legend').innerHTML = a.s.map((n, i) => `<div class="rowline"><span><i class="sw ${SENT[i]}"></i>${RAW.sent[i]}</span><span class="n">${fInt(n)}</span><b>${a.rv ? fPct(n / a.rv) : '–'}</b></div>`).join('');

  // patient-level mix: count each patient once (their latest visit in scope)
  const pat = new Map(), cnt = new Map();
  for (const r of cur.rows) { pat.set(r.pid, r); cnt.set(r.pid, (cnt.get(r.pid) || 0) + 1); }
  const gc = RAW.gender.map(() => 0), ac = AGE_GROUPS.map(() => 0);
  for (const r of pat.values()) { gc[r.gender]++; if (r.ag >= 0) ac[r.ag]++; }
  const gcls = ['o3', 'o1', 'o2', 'o4', 'neu'];
  $('#gender-n').textContent = `${fInt(pat.size)} patients`;
  stackBar('#gender-bar', '#gender-legend', gc, RAW.gender, RAW.gender.map((_, i) => gcls[i % gcls.length]));
  $('#age-n').textContent = 'years';
  stackBar('#age-bar', '#age-legend', ac, AGE_GROUPS, ['o1', 'o2', 'o3', 'o4', 'neu']);
  const fq = [0, 0, 0]; for (const v of cnt.values()) fq[Math.min(v, 3) - 1]++;
  $('#freq-n').textContent = `${fInt(cnt.size)} patients`;
  stackBar('#freq-bar', '#freq-legend', fq, ['1 visit', '2 visits', '3+ visits'], ['o1', 'o2', 'o3']);
}

/* ── render: departments ── */
function groupStats(key, names) {
  const g = new Map();
  for (const r of cur.rows) { const k = key(r); (g.get(k) || g.set(k, []).get(k)).push(r); }
  return [...g].map(([k, rows]) => {
    const a = agg(rows), t = new Map();
    for (const r of rows) if (r.sent === 2) t.set(r.topik, (t.get(r.topik) || 0) + 1);
    const top = [...t].sort((x, y) => y[1] - x[1])[0];
    return { k, name: names(k), rows, a, n: a.n, rev: a.rev, rating: rating(a), neg: negShare(a), fu: fuRate(a), top: top && a.s[2] >= 3 ? { name: RAW.topik[top[0]], n: top[1], of: a.s[2] } : null };
  });
}
function renderDepts() {
  const list = groupStats(r => r.dept, i => RAW.dept[i]).sort((x, y) => y.rev - x.rev), box = $('#dept');
  if (!list.length) { box.innerHTML = '<div class="empty">No visits for this selection.</div>'; return; }
  const mx = Math.max(...list.map(d => d.rev)), cols = 'minmax(140px,1.2fr) minmax(110px,1.3fr) 52px 64px minmax(120px,1.1fr)';
  box.innerHTML = `<div class="lrow asp-h" style="--cols:${cols}"><span>Department</span><span>Revenue</span><span class="num">Rating</span><span class="num">Follow-up</span><span>Top complaint</span></div>` +
    list.map((d, k) => { const docs = new Set(d.rows.map(r => r.doc)).size; return `<div class="lrow" data-k="${k}" style="--cols:${cols}"><div class="main"><b>${esc(d.name)}</b><span>${fInt(d.n)} visits · ${docs} doctor${docs > 1 ? 's' : ''}</span></div><div class="hb"><i style="width:${d.rev / mx * 100}%"></i><span>${fRs(d.rev)}</span></div><span class="num${d.a.rv < MIN_N ? ' low-n' : ''}" data-l="Rating">${d.a.rv ? fDec(d.rating) : '–'}</span><span class="num" data-l="Follow-up">${fPct(d.fu, 0)}</span><div class="sub2">${d.top ? `<b>${esc(d.top.name)}</b><span>${fInt(d.top.n)} of ${fInt(d.top.of)} negative</span>` : '<span>Too few negative feedback</span>'}</div></div>`; }).join('');
  box.querySelectorAll('.lrow[data-k]').forEach(row => {
    const d = list[+row.dataset.k];
    bindTip(row, `<div class="t">${esc(d.name)}</div><div class="v">${fRs(d.rev)}</div>` + tipRow('Visits', fInt(d.n)) + tipRow('Patients', fInt(d.a.pats.size)) + tipRow('Avg bill', fRsFull(d.rev / d.n)) + tipRow('Avg wait', d.a.wN ? fMin(avgWait(d.a)) : '–') + tipRow('Satisfaction', d.a.rv ? fDec(d.rating) : '–') + tipRow('Negative', d.a.rv ? fPct(d.neg) : '–'));
  });
}

/* ── render: issues + payment ── */
function renderIssues() {
  const list = groupStats(r => r.issue, i => RAW.issue[i]).sort((x, y) => y.n - x.n).slice(0, 10), box = $('#issue');
  if (!list.length) { box.innerHTML = '<div class="empty">No visits for this selection.</div>'; return; }
  const mx = Math.max(...list.map(d => d.n)), cols = 'minmax(140px,1.3fr) minmax(100px,1.2fr) 70px 80px';
  box.innerHTML = `<div class="lrow asp-h" style="--cols:${cols}"><span>Issue</span><span>Visits</span><span class="num">Follow-up</span><span class="num">Avg bill</span></div>` +
    list.map((d, k) => { const depts = [...new Set(d.rows.map(r => RAW.dept[r.dept]))]; return `<div class="lrow" data-k="${k}" style="--cols:${cols}"><div class="main"><b>${esc(d.name)}</b><span>${esc(depts.slice(0, 2).join(', '))}${depts.length > 2 ? '…' : ''}</span></div><div class="hb"><i style="width:${d.n / mx * 100}%"></i><span>${fInt(d.n)}</span></div><span class="num" data-l="Follow-up">${fPct(d.fu, 0)}</span><span class="num" data-l="Avg bill">${fRsFull(d.rev / d.n)}</span></div>`; }).join('');
  box.querySelectorAll('.lrow[data-k]').forEach(row => {
    const d = list[+row.dataset.k], ag = AGE_GROUPS.map(() => 0); for (const r of d.rows) if (r.ag >= 0) ag[r.ag]++;
    const topAge = ag.indexOf(Math.max(...ag));
    bindTip(row, `<div class="t">${esc(d.name)}</div><div class="v">${fInt(d.n)} visits</div>` + tipRow('Patients', fInt(d.a.pats.size)) + tipRow('Most common age', AGE_GROUPS[topAge]) + tipRow('Follow-up needed', fPct(d.fu)) + tipRow('Revenue', fRs(d.rev)) + tipRow('Satisfaction', d.a.rv ? fDec(d.rating) : '–'));
  });
}
function renderPay() {
  const a = cur.all, list = groupStats(r => r.pay, i => RAW.pay[i]).sort((x, y) => y.n - x.n), box = $('#pay');
  if (!list.length) { box.innerHTML = '<div class="empty">No visits for this selection.</div>'; $('#pay-note').textContent = ''; return; }
  const mx = Math.max(...list.map(d => d.n)), cols = 'minmax(120px,1.3fr) minmax(90px,1.2fr) 74px';
  box.innerHTML = `<div class="lrow asp-h" style="--cols:${cols}"><span>Mode</span><span>Share of visits</span><span class="num">Revenue</span></div>` +
    list.map((d, k) => `<div class="lrow" data-k="${k}" style="--cols:${cols}"><div class="main"><b>${esc(d.name)}</b><span>${fRsFull(d.rev / d.n)} avg bill</span></div><div class="hb"><i style="width:${d.n / mx * 100}%"></i><span>${fPct(d.n / a.n, 0)}</span></div><span class="num" data-l="Revenue">${fRs(d.rev)}</span></div>`).join('');
  box.querySelectorAll('.lrow[data-k]').forEach(row => {
    const d = list[+row.dataset.k];
    bindTip(row, `<div class="t">${esc(d.name)}</div><div class="v">${fInt(d.n)} visits</div>` + tipRow('Share of visits', fPct(d.n / a.n)) + tipRow('Share of revenue', fPct(d.rev / a.rev)) + tipRow('Avg bill', fRsFull(d.rev / d.n)));
  });
  $('#pay-note').textContent = `Insurance and government schemes (Ayushman Bharat, CGHS) cover ${fPct(a.scheme / a.rev || 0, 0)} of revenue in this view.`;
}

/* ── render: feedback topics ── */
function topicStats() {
  return RAW.topik.map((name, i) => { const a = agg(cur.rows.filter(r => r.topik === i)); return { name, a, n: a.rv, neg: negShare(a), pos: posShare(a), rating: rating(a) }; }).filter(d => d.n);
}
function renderTopics() {
  const list = topicStats().sort((x, y) => y.neg - x.neg), box = $('#asp');
  if (!list.length) { box.innerHTML = '<div class="empty">No feedback for this selection yet.</div>'; return; }
  box.innerHTML = '<div class="asp-row asp-h"><span>Topic</span><span>Sentiment mix</span><span>Negative</span><span>Rating</span><span>Feedback</span></div>' +
    list.map((d, k) => `<div class="asp-row" data-k="${k}"><span class="asp-name">${esc(d.name)}</span><div class="asp-bar">${d.a.s.map((n, i) => n ? `<span class="${SENT[i]}" style="flex:${n}" data-i="${i}"><em>${fPct(n / d.n, 0)}</em></span>` : '').join('')}</div><span class="num"><b>${fPct(d.neg)}</b></span><span class="num">${fDec(d.rating)}</span><span class="num${d.n < MIN_N ? ' low-n' : ''}">${fInt(d.n)}</span></div>`).join('');
  box.querySelectorAll('.asp-bar span').forEach(seg => {
    const d = list[+seg.closest('.asp-row').dataset.k], i = +seg.dataset.i, em = seg.firstChild;
    if (em.scrollWidth + 10 > seg.clientWidth) em.remove();
    bindTip(seg, `<div class="t">${esc(d.name)} · ${RAW.sent[i]}</div><div class="v">${fPct(d.a.s[i] / d.n)}</div>` + tipRow('Feedback', `${fInt(d.a.s[i])} of ${fInt(d.n)}`));
  });
}

/* ── render: waiting time ── */
const WAIT_BINS = [[0, 15, '0–15'], [15, 30, '15–30'], [30, 45, '30–45'], [45, 60, '45–60'], [60, 90, '60–90'], [90, 120, '90–120'], [120, Infinity, '120+']];
function renderWait() {
  const a = cur.all;
  $('#wait-stats').innerHTML =
    `<div class="stat"><span>Average wait</span><b>${a.wN ? fMin(avgWait(a)) : '–'}</b><small>${fInt(a.longN)} waited over ${LONG_WAIT} min</small></div>` +
    `<div class="stat"><span>Rating, wait ≤ ${LONG_WAIT} min</span><b>${a.shortRv ? fDec(a.shortSum / a.shortRv) : '–'}</b><small>${fInt(a.shortRv)} feedback</small></div>` +
    `<div class="stat"><span>Rating, wait &gt; ${LONG_WAIT} min</span><b>${a.longRv ? fDec(a.longSum / a.longRv) : '–'}</b><small>${fInt(a.longRv)} feedback</small></div>`;
  const box = $('#waitChart');
  if (!a.wN) { box.innerHTML = '<div class="empty">No waiting-time data.</div>'; return; }
  const items = WAIT_BINS.map(([lo, hi, label]) => {
    const rs = cur.rows.filter(r => r.wait != null && r.wait >= lo && r.wait < hi), b = agg(rs);
    return { label, value: rs.length, cls: hi <= 30 ? 'pos' : lo >= 60 ? 'neg' : 'mid', tip: `<div class="t">${label} minutes</div><div class="v">${fInt(rs.length)} visits</div>` + tipRow('Share', fPct(rs.length / a.wN)) + tipRow('Satisfaction', b.rv ? fDec(rating(b)) : '–') + tipRow('Negative', b.rv ? fPct(negShare(b)) : '–') };
  });
  barChart(box, items, { h: 250, bw: 26, noSkip: true, m: { b: 46 }, xTitle: 'waiting time (minutes)', aria: 'Distribution of waiting time' });
}

/* ── render: insights ── */
function renderInsights() {
  const a = cur.all, out = [], tp = topicStats().filter(d => d.n >= MIN_N);
  if (tp.length > 1) {
    const worst = tp.reduce((b, d) => d.neg > b.neg ? d : b), best = tp.reduce((b, d) => d.rating > b.rating ? d : b);
    out.push([`${worst.name} draws the most complaints`, `${fPct(worst.neg, 0)} of ${fInt(worst.n)} feedback on this topic is negative (rating ${fDec(worst.rating)}), the highest of any topic.`]);
    if (best !== worst) out.push([`${best.name} earns the best feedback`, `Rating ${fDec(best.rating)} with ${fPct(best.neg, 0)} negative out of ${fInt(best.n)} feedback.`]);
  }
  if (a.longRv >= 10 && a.shortRv >= 10) {
    const gap = a.shortSum / a.shortRv - a.longSum / a.longRv;
    out.push([`Long waits ${gap > 0 ? 'lower' : 'do not lower'} satisfaction`, `${fPct(a.longN / a.wN)} of visits waited over ${LONG_WAIT} minutes. Those patients rate ${fDec(a.longSum / a.longRv)}, versus ${fDec(a.shortSum / a.shortRv)} for shorter waits (a ${fDec(Math.abs(gap))}-point gap).`]);
  }
  if (state.dept < 0) {
    const dp = groupStats(r => r.dept, i => RAW.dept[i]).filter(d => d.a.rv >= MIN_N);
    if (dp.length > 1) {
      const lo = dp.reduce((b, d) => d.rating < b.rating ? d : b), hi = dp.reduce((b, d) => d.rating > b.rating ? d : b);
      out.push([`${lo.name} has the lowest satisfaction`, `Rating ${fDec(lo.rating)} with ${fPct(lo.neg, 0)} negative feedback; ${hi.name} leads at ${fDec(hi.rating)}.`]);
    }
  }
  const fuIssues = groupStats(r => r.issue, i => RAW.issue[i]).filter(d => d.n >= 15).sort((x, y) => y.fu - x.fu);
  if (fuIssues.length && a.n) out.push([`${fPct(fuRate(a), 0)} of visits need a follow-up`, `${fuIssues[0].name} has the highest follow-up rate (${fPct(fuIssues[0].fu, 0)} of ${fInt(fuIssues[0].n)} visits), a candidate for reminder calls or care plans.`]);
  if (state.city < 0) {
    const ct = groupStats(r => r.city, i => RAW.city[i]).filter(d => d.a.wN >= MIN_N);
    if (ct.length > 1) { const w = ct.reduce((b, d) => avgWait(d.a) > avgWait(b.a) ? d : b), f = ct.reduce((b, d) => avgWait(d.a) < avgWait(b.a) ? d : b); out.push([`${w.name} branch has the longest waits`, `Average ${fMin(avgWait(w.a))}, compared with ${fMin(avgWait(f.a))} in ${f.name}.`]); }
  }
  if (cur.first3 && cur.first3.wN >= MIN_N && cur.last3.wN >= MIN_N) {
    const f = avgWait(cur.first3), l = avgWait(cur.last3), P = cur.P, d = Math.abs(l - f) < 1 ? 'held steady' : l < f ? 'improved' : 'worsened';
    out.push([`Waiting time ${d} over the period`, `From ${fMin(f)} in ${mRange(P.a, P.a + 2)} to ${fMin(l)} in ${mRange(P.b - 2, P.b)}; satisfaction moved from ${cur.first3.rv ? fDec(rating(cur.first3)) : '–'} to ${cur.last3.rv ? fDec(rating(cur.last3)) : '–'}.`]);
  }
  $('#ins').innerHTML = out.length ? out.slice(0, 6).map((o, i) => `<li><span class="k">${i + 1}</span><div><b>${esc(o[0])}</b><p>${esc(o[1])}</p></div></li>`).join('') : `<li class="empty" style="grid-template-columns:1fr">Sample too small (under ${MIN_N} feedback) to draw reliable insights.</li>`;
}

/* ── render: segment table ── */
const DIMS = {
  dept: { label: 'Department', key: r => r.dept, name: i => RAW.dept[i] },
  doc: { label: 'Doctor', key: r => r.doc, name: i => RAW.doc[i] },
  city: { label: 'City', key: r => r.city, name: i => RAW.city[i] },
  gender: { label: 'Gender', key: r => r.gender, name: i => RAW.gender[i] },
  ag: { label: 'Age group', key: r => r.ag, name: i => i >= 0 ? AGE_GROUPS[i] : 'Unknown' },
  vtype: { label: 'Visit type', key: r => r.vtype, name: i => RAW.vtype[i] },
  pay: { label: 'Payment', key: r => r.pay, name: i => RAW.pay[i] },
};
const COLS = [['n', 'Visits'], ['pats', 'Patients'], ['rev', 'Revenue'], ['bill', 'Avg bill'], ['wait', 'Avg wait'], ['fu', 'Follow-up'], ['rv', 'Feedback'], ['rating', 'Rating'], ['pos', 'Positive'], ['neg', 'Negative']];
function renderDim() {
  const D = DIMS[state.dim], g = new Map();
  for (const r of cur.rows) { const k = D.key(r); (g.get(k) || g.set(k, []).get(k)).push(r); }
  const list = [...g].map(([k, rows]) => { const a = agg(rows); return { k, name: D.name(k), n: a.n, pats: a.pats.size, rev: a.rev, bill: a.rev / a.n, wait: avgWait(a), fu: fuRate(a), rv: a.rv, rating: rating(a), neg: negShare(a), pos: posShare(a) }; });
  const { key, dir } = state.sort;
  list.sort((x, y) => key === 'name' ? (state.dim === 'ag' ? dir * (x.k - y.k) : dir * x.name.localeCompare(y.name)) : dir * ((x[key] ?? -1) - (y[key] ?? -1)));
  const mx = Math.max(1, ...list.map(d => d.n));
  const th = (k, t, r) => `<th${r ? ' class="r"' : ''}${key === k ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-k="${k}">${t}${key === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`;
  $('#dim-table').innerHTML = `<thead><tr>${th('name', D.label)}${COLS.map((c, i) => th(c[0], c[1], i > 0)).join('')}</tr></thead><tbody>` +
    (list.length ? list.map(d => { const low = d.rv < MIN_N ? ' low-n' : ''; return `<tr><td><b style="font-weight:600;white-space:nowrap">${esc(d.name)}</b></td><td><div class="cellbar"><span>${fInt(d.n)}</span><i style="width:${d.n / mx * 100}%"></i></div></td><td class="r">${fInt(d.pats)}</td><td class="r">${fRs(d.rev)}</td><td class="r">${fRsFull(d.bill)}</td><td class="r">${d.wait != null ? fMin(d.wait) : '–'}</td><td class="r">${fPct(d.fu)}</td><td class="r${low}">${fInt(d.rv)}</td><td class="r${low}">${d.rv ? fDec(d.rating) : '–'}</td><td class="r${low}">${d.rv ? fPct(d.pos) : '–'}</td><td class="r${low}">${d.rv ? fPct(d.neg) : '–'}</td></tr>`; }).join('') : '<tr><td colspan="11" class="empty">No data.</td></tr>') + '</tbody>';
  $('#dim-note').textContent = list.some(d => d.rv < MIN_N) ? `Greyed figures come from fewer than ${MIN_N} feedback; read with care.` : 'Rating, Positive, and Negative are computed from visits with feedback.';
}

/* ── render: visit records ── */
const PAGE = 10;
const RV_TABS = { all: ['All', () => true], fu: ['Follow-up needed', r => r.fu], neg: ['Negative', r => r.sent === 2], neu: ['Neutral', r => r.sent === 1], pos: ['Positive', r => r.sent === 0] };
function renderVisits() {
  const q = state.q.trim().toLowerCase(), f = RV_TABS[state.rvTab][1];
  const list = cur.rows.filter(r => f(r) && (!q || [r.text, r.name, r.pid, r.id, RAW.dept[r.dept], RAW.issue[r.issue], RAW.doc[r.doc], RAW.city[r.city], RAW.pay[r.pay], RAW.vtype[r.vtype]].join(' ').toLowerCase().includes(q)))
    .sort(state.rvTab === 'fu' ? (x, y) => (x.fuDate || '9').localeCompare(y.fuDate || '9') : (x, y) => (y.date + y.time).localeCompare(x.date + x.time) || y.id.localeCompare(x.id));
  const pages = Math.max(1, Math.ceil(list.length / PAGE)); state.page = Math.min(state.page, pages - 1);
  const view = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
  $('#rv-sub').textContent = state.rvTab === 'fu' ? 'Sorted by follow-up date, earliest first' : 'Newest visit first';
  const vcls = v => /emerg/i.test(v) ? ' em' : /follow/i.test(v) ? ' fu' : '';
  $('#rv-table').innerHTML = '<thead><tr><th>Date</th><th>Patient</th><th>Department · Doctor</th><th>Issue</th><th>Visit</th><th class="r">Bill</th><th>Follow-up</th><th>Rating</th><th>Feedback</th></tr></thead><tbody>' +
    (view.length ? view.map(r => `<tr><td style="white-space:nowrap">${fDate(r.date)}<div class="rv-sub">${esc(r.time)}</div></td><td><div class="rv-id">${esc(r.name)}</div><div class="rv-sub">${esc(r.pid)} · ${esc(RAW.gender[r.gender])}${r.age >= 0 ? ', ' + r.age + ' y' : ''} · ${esc(RAW.city[r.city])}</div></td><td><div class="rv-id" style="font-weight:500">${esc(RAW.dept[r.dept])}</div><div class="rv-sub">${esc(RAW.doc[r.doc])}</div></td><td>${esc(RAW.issue[r.issue])}</td><td><span class="tag${vcls(RAW.vtype[r.vtype])}">${esc(RAW.vtype[r.vtype])}</span>${r.wait != null ? `<div class="rv-sub">waited ${fInt(r.wait)} min</div>` : ''}</td><td class="r bill"><b>${fRsFull(r.total)}</b><span>${esc(RAW.pay[r.pay])}</span></td><td style="white-space:nowrap">${r.fu ? `<span class="tag fu">Yes</span><div class="rv-sub">${fDate(r.fuDate)}</div>` : '<span class="rv-sub">No</span>'}</td><td>${r.rating != null ? `<span class="stars" title="${r.rating} of 5"><b>${'★'.repeat(r.rating)}</b>${'★'.repeat(5 - r.rating)}</span><div><span class="pill ${SENT[r.sent]}">${RAW.sent[r.sent]}</span></div>` : '<span class="rv-sub">–</span>'}</td><td><div class="rv-text" title="${esc(r.text)}">${esc(r.text) || '<span class="rv-sub">No feedback</span>'}</div></td></tr>`).join('') : '<tr><td colspan="9" class="empty">No matching visits.</td></tr>') + '</tbody>';
  $('#rv-info').textContent = list.length ? `${fInt(state.page * PAGE + 1)}–${fInt(state.page * PAGE + view.length)} of ${fInt(list.length)} visits` : '0 visits';
  $('#rv-prev').disabled = state.page === 0; $('#rv-next').disabled = state.page >= pages - 1;
}

/* ── controls ── */
function segmented(id, opts, get, set) {
  const box = $(id);
  box.innerHTML = opts.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('');
  const sync = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v) === String(get())));
  box.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); sync(); });
  sync();
}
const FILTERS = [['#f-period', 'period'], ['#f-dept', 'dept'], ['#f-city', 'city'], ['#f-gender', 'gender'], ['#f-vtype', 'vtype']];
const fillSelect = (id, opts) => { $(id).innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join(''); };
function renderAll() {
  compute();
  const a = cur.all;
  $('#scope').innerHTML = `Showing <b>${fInt(a.n)}</b> visits · <b>${fInt(a.pats.size)}</b> patients · <b>${fInt(a.rv)}</b> feedback`;
  $('#f-reset').hidden = !(state.period || state.dept >= 0 || state.city >= 0 || state.gender >= 0 || state.vtype >= 0);
  renderSummary(); renderTrend(); renderMix(); renderDepts(); renderInsights(); renderIssues(); renderPay(); renderTopics(); renderWait(); renderDim(); renderVisits();
}

/* ── loading ── */
function notice(html) { const n = $('#notice'); n.innerHTML = html; n.hidden = !html; }
function load(text, source) {
  RAW = normalize(parseCSV(text), source);
  ROWS = RAW.rows; NM = RAW.months.length;
  PERIODS = [{ label: `${NM} month${NM > 1 ? 's' : ''} · ${mRange(0, NM - 1)}`, a: 0, b: NM - 1 }];
  if (NM > 6) PERIODS.push({ label: `Last 6 months · ${mRange(NM - 6, NM - 1)}`, a: NM - 6, b: NM - 1 });
  if (NM > 3) for (let a = 0; a + 2 < NM; a += 3) PERIODS.push({ label: mRange(a, a + 2), a, b: a + 2 });
  Object.assign(state, { period: 0, dept: -1, city: -1, gender: -1, vtype: -1, page: 0, q: '' });
  $('#rv-q').value = '';
  fillSelect('#f-period', PERIODS.map((p, i) => [i, p.label]));
  fillSelect('#f-dept', [[-1, 'All departments'], ...RAW.dept.map((k, i) => [i, k])]);
  fillSelect('#f-city', [[-1, 'All cities'], ...RAW.city.map((k, i) => [i, k])]);
  fillSelect('#f-gender', [[-1, 'All genders'], ...RAW.gender.map((k, i) => [i, k])]);
  fillSelect('#f-vtype', [[-1, 'All visit types'], ...RAW.vtype.map((k, i) => [i, k])]);

  document.title = `Patient Visits · ${HOSPITAL}`;
  $('#brand-name').textContent = HOSPITAL; $('#crumb').textContent = `${HOSPITAL} / Dashboard`; $('#title').textContent = 'Patient Visits & Satisfaction';
  $('#ds-f').textContent = source; $('#ds-n').textContent = fInt(ROWS.length); $('#ds-p').textContent = fInt(new Set(ROWS.map(r => r.pid)).size);
  $('#ds-d').textContent = fInt(RAW.doc.length); $('#ds-c').textContent = fInt(RAW.city.length); $('#ds-t').textContent = mRange(0, NM - 1);
  notice(''); $('#dash').hidden = false;
  renderAll();
}
function loadFile(file) {
  if (!file) return;
  file.text().then(t => load(t, file.name)).catch(err => notice(`<b>Could not load ${esc(file.name)}.</b> ${esc(err.message)}`));
}

(function init() {
  FILTERS.forEach(([id, key]) => $(id).addEventListener('change', e => { state[key] = +e.target.value; state.page = 0; renderAll(); }));
  $('#f-reset').addEventListener('click', () => { Object.assign(state, { period: 0, dept: -1, city: -1, gender: -1, vtype: -1, page: 0 }); FILTERS.forEach(([id, key]) => { $(id).value = state[key]; }); renderAll(); });

  segmented('#metric-seg', Object.entries(METRICS).map(([k, m]) => [k, m.label]), () => state.metric, v => { state.metric = v; renderTrend(); });
  segmented('#dim-seg', Object.entries(DIMS).map(([k, d]) => [k, d.label]), () => state.dim, v => { state.dim = v; state.sort = { key: 'n', dir: -1 }; renderDim(); });
  segmented('#rv-seg', Object.entries(RV_TABS).map(([k, t]) => [k, t[0]]), () => state.rvTab, v => { state.rvTab = v; state.page = 0; renderVisits(); });
  $('#dim-table').addEventListener('click', e => { const b = e.target.closest('th button'); if (!b) return; const k = b.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'name' ? 1 : -1) }; renderDim(); });
  $('#rv-q').addEventListener('input', e => { state.q = e.target.value; state.page = 0; renderVisits(); });
  $('#rv-prev').addEventListener('click', () => { state.page--; renderVisits(); });
  $('#rv-next').addEventListener('click', () => { state.page++; renderVisits(); });
  $('#btn-print').addEventListener('click', () => print());
  $('#btn-theme').addEventListener('click', () => { const d = document.documentElement, dark = d.dataset.theme !== 'dark'; d.dataset.theme = dark ? 'dark' : 'light'; $('#btn-theme span').textContent = dark ? 'Light' : 'Dark'; });
  if (location.hash === '#dark' || (matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)) $('#btn-theme').click();

  $('#btn-load').addEventListener('click', () => $('#file-in').click());
  $('#file-in').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('#drop');
  addEventListener('dragover', e => { e.preventDefault(); drop.hidden = false; });
  drop.addEventListener('dragleave', () => { drop.hidden = true; });
  addEventListener('drop', e => { e.preventDefault(); drop.hidden = true; loadFile(e.dataTransfer.files[0]); });

  const links = [...document.querySelectorAll('.nav a')];
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(l => l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-20% 0px -65% 0px' });
  document.querySelectorAll('main section[id]').forEach(s => io.observe(s));

  let t; addEventListener('resize', () => { if (!cur) return; clearTimeout(t); t = setTimeout(() => { renderTrend(); renderTopics(); renderWait(); }, 120); });

  notice('Loading data…');
  fetch(DATA_URL).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then(text => { load(text, DATA_URL.split('/').pop()); if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderTopics); })
    .catch(err => notice(`<b>Could not load <code>${esc(DATA_URL)}</code></b> (${esc(err.message)}). If you opened this page straight from disk, browsers block reading local files: serve the folder (e.g. <code>python -m http.server</code>) or click <b>Load CSV</b> / drop a file here.`));
})();
