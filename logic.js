// Pure data logic for Calibr. No DOM access, so it can be unit-tested in Node.

export const CURRENCIES = [
  ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'], ['CAD', 'Canadian Dollar'],
  ['AUD', 'Australian Dollar'], ['NZD', 'New Zealand Dollar'], ['JPY', 'Japanese Yen'],
  ['INR', 'Indian Rupee'], ['MXN', 'Mexican Peso'], ['BRL', 'Brazilian Real'],
  ['CHF', 'Swiss Franc'], ['SEK', 'Swedish Krona'], ['NOK', 'Norwegian Krone'],
  ['DKK', 'Danish Krone'], ['PLN', 'Polish Zloty'], ['ZAR', 'South African Rand'],
  ['SGD', 'Singapore Dollar'], ['HKD', 'Hong Kong Dollar'], ['KRW', 'South Korean Won'],
  ['CNY', 'Chinese Yuan'], ['PHP', 'Philippine Peso'], ['AED', 'UAE Dirham'],
];

export const FREQUENCIES = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', yearly: 'Yearly' };

export const KINDS = ['grocery', 'dining', 'coffee', 'fuel', 'transport', 'shopping', 'health', 'entertainment', 'fitness', 'home', 'pets', 'personal', 'travel', 'education', 'services'];
export const THRESHOLDS = { cautious: 0.85, balanced: 0.7, eager: 0.55 };
// Knobs of the suggestion model (exported so the simulation can tune them).
export const TUNING = {
  cap: 0.65,     // most confidence a built-in default can give a category before the user's own history says so
  k0: 3,         // the default counts as this many past visits
  unknown: 0.12, // chance mass kept for "somewhere we don't list"
  margin: 0.15,  // top choice must lead the runner-up by this much to auto-file
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const p2 = n => String(n).padStart(2, '0');

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 12);

// ---- dates (all local, as YYYY-MM-DD / YYYY-MM strings) ----
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const todayStr = () => ymd(new Date());
export const monthOf = s => s.slice(0, 7);
export const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`;
};
export const daysInMonth = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const dateIn = (key, day) => `${key}-${p2(Math.min(day, daysInMonth(key)))}`;
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export const monthsBetween = (a, b) => {
  const [y1, m1] = monthOf(a).split('-').map(Number), [y2, m2] = monthOf(b).split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};
export const daysLeftInMonth = today => daysInMonth(monthOf(today)) - Number(today.slice(8)) + 1;

// ---- state ----
export const defaultState = () => ({
  v: 2,
  settings: { currency: 'USD', income: 0, theme: 'auto', onboarded: false, lastCat: null, level: 'balanced', locate: true, lastAmount: 0, quickOpen: false, incomeMode: 'steady', planOverride: 0, moved: {}, lastBackup: '', installDismissed: false, dismissedRecurring: [] },
  categories: [],
  transactions: [],
  recurring: [],
  goals: [],
  learn: { merchants: {}, spots: [], stats: { auto: 0, fixed: 0, confirmed: 0 } },
  overrides: {}, // { 'YYYY-MM': { categoryId: limit } } for one-month changes
});

const CODES = new Set(CURRENCIES.map(c => c[0]));
const THEMES = new Set(['auto', 'light', 'dark']);

// Coerces anything (a stored blob, an imported file, a v1 save) into a valid v2 state, or null.
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
  const str = (x, d = '') => (typeof x === 'string' ? x : d);
  const seen = new Set();
  const id = x => { let v = str(x) || uid(); while (seen.has(v)) v = uid(); seen.add(v); return v; };

  const s = defaultState();
  const st = raw.settings || {};
  s.settings = {
    currency: CODES.has(st.currency) ? st.currency : 'USD',
    income: Math.max(0, round2(num(st.income))),
    theme: THEMES.has(st.theme) ? st.theme : 'auto',
    onboarded: raw.settings ? !!st.onboarded : true, // a pre-v2 save means an existing user
    lastCat: str(st.lastCat) || null,
    level: st.level in THRESHOLDS ? st.level : 'balanced',
    locate: st.locate !== false,
    lastAmount: Math.max(0, round2(num(st.lastAmount))),
    quickOpen: !!st.quickOpen,
    incomeMode: st.incomeMode === 'varies' ? 'varies' : 'steady',
    lastBackup: DATE.test(str(st.lastBackup)) ? st.lastBackup : '',
    installDismissed: !!st.installDismissed,
    dismissedRecurring: (Array.isArray(st.dismissedRecurring) ? st.dismissedRecurring : []).filter(x => typeof x === 'string').slice(-100),
    planOverride: Math.max(0, round2(num(st.planOverride))),
    moved: Object.fromEntries(Object.entries(st.moved && typeof st.moved === 'object' ? st.moved : {}).filter(([k, v]) => MONTH.test(k) && num(v) > 0).map(([k, v]) => [k, round2(num(v))])),
  };

  s.categories = (Array.isArray(raw.categories) ? raw.categories : [])
    .filter(c => c && typeof c.name === 'string' && c.name.trim())
    .map(c => ({
      id: id(c.id), emoji: str(c.emoji, '🏷️') || '🏷️', name: c.name.trim().slice(0, 40),
      limit: Math.max(0, round2(num(c.limit))), rollover: !!c.rollover,
      since: MONTH.test(c.since) ? c.since : undefined,
      kind: KINDS.includes(c.kind) ? c.kind : undefined,
      essential: !!c.essential,
    }));
  const catIds = new Set(s.categories.map(c => c.id));

  const txRaw = Array.isArray(raw.transactions) ? raw.transactions : Array.isArray(raw.expenses) ? raw.expenses : [];
  s.transactions = txRaw
    .filter(t => t && num(t.amount) > 0 && DATE.test(str(t.date)))
    .map(t => {
      const income = t.type === 'income';
      return {
        id: id(t.id), type: income ? 'income' : 'expense', amount: round2(num(t.amount)),
        cat: !income && catIds.has(t.cat) ? t.cat : null, note: str(t.note).trim().slice(0, 80), date: t.date,
        ...(t.rec ? { rec: str(t.rec) } : {}),
        ...(income && t.src === 'buffer' ? { src: 'buffer' } : {}),
        ...(!income && t.status === 'review' ? { status: 'review', sugg: (Array.isArray(t.sugg) ? t.sugg : []).filter(x => catIds.has(x)).slice(0, 3) } : {}),
        ...(t.auto && !income && catIds.has(t.cat) ? { auto: true } : {}),
        ...(str(t.merchant) ? { merchant: str(t.merchant).slice(0, 80), mkey: str(t.mkey).slice(0, 80) } : {}),
        ...(Array.isArray(t.near) && t.near.length ? { near: t.near.filter(x => typeof x === 'string').slice(0, 2).map(x => x.slice(0, 60)) } : {}),
        ...(Array.isArray(t.loc) && t.loc.length === 2 && t.loc.every(Number.isFinite) ? { loc: t.loc.map(x => Math.round(x * 1e4) / 1e4) } : {}),
      };
    });

  s.recurring = (Array.isArray(raw.recurring) ? raw.recurring : [])
    .filter(r => r && num(r.amount) > 0 && DATE.test(str(r.next)) && r.freq in FREQUENCIES)
    .map(r => {
      const income = r.type === 'income';
      return {
        id: id(r.id), type: income ? 'income' : 'expense', amount: round2(num(r.amount)),
        cat: !income && catIds.has(r.cat) ? r.cat : null, note: str(r.note).trim().slice(0, 80),
        freq: r.freq, next: r.next, anchor: Number(r.next.slice(8)),
      };
    });

  s.goals = (Array.isArray(raw.goals) ? raw.goals : [])
    .filter(g => g && typeof g.name === 'string' && g.name.trim() && num(g.target) > 0)
    .map(g => ({
      id: id(g.id), emoji: str(g.emoji, '🎯') || '🎯', name: g.name.trim().slice(0, 40),
      target: round2(num(g.target)), saved: Math.max(0, round2(num(g.saved))), date: DATE.test(str(g.date)) ? g.date : '',
      ...(g.buffer ? { buffer: true } : {}),
    }));
  for (const [m, o] of Object.entries(raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {})) {
    if (!MONTH.test(m) || !o || typeof o !== 'object') continue;
    const clean = Object.fromEntries(Object.entries(o).filter(([c, v]) => catIds.has(c) && Number.isFinite(+v) && +v >= 0).map(([c, v]) => [c, round2(+v)]));
    if (Object.keys(clean).length) s.overrides[m] = clean;
  }
  const cleanCats = o => {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) if (catIds.has(k) && num(v) > 0) out[k] = Math.min(10000, Math.round(num(v)));
    return out;
  };
  const lm = raw.learn?.merchants && typeof raw.learn.merchants === 'object' ? raw.learn.merchants : {};
  for (const [k, m] of Object.entries(lm).slice(0, 3000)) {
    const cats = cleanCats(m?.cats), n = Object.values(cats).reduce((a, b) => a + b, 0);
    if (n > 0) {
      const lm = {};
      for (const [c, v] of Object.entries(m.lm && typeof m.lm === 'object' ? m.lm : {})) if (cats[c] && Array.isArray(v) && Number.isFinite(+v[0]) && Number.isFinite(+v[1]) && +v[0] > 0) lm[c] = [Math.round(+v[0]), +v[1]];
      s.learn.merchants[k.slice(0, 80)] = { name: str(m.name).slice(0, 80), n, cats, amt: Math.max(0, round2(num(m.amt))), lm };
    }
  }
  s.learn.spots = (Array.isArray(raw.learn?.spots) ? raw.learn.spots : []).slice(0, 400)
    .filter(p => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng))
    .map(p => { const cats = cleanCats(p.cats); return { lat: +p.lat, lng: +p.lng, n: Object.values(cats).reduce((a, b) => a + b, 0), cats }; })
    .filter(p => p.n > 0);
  const lst = raw.learn?.stats;
  s.learn.stats = { auto: Math.max(0, Math.round(num(lst?.auto))), fixed: Math.max(0, Math.round(num(lst?.fixed))), confirmed: Math.max(0, Math.round(num(lst?.confirmed))) };
  return s;
}
export const migrate = sanitize;

// ---- starter categories ----
// [emoji, name, kind, % of income, picked by default, essential]
export const PRESETS = [
  ['🏠', 'Housing', '', 30, 0, 1], ['🛒', 'Groceries', 'grocery', 12, 1, 1], ['🍽️', 'Eating out', 'dining', 6, 1],
  ['☕', 'Coffee', 'coffee', 2, 0], ['🚗', 'Transport', 'transport', 8, 1], ['⛽', 'Gas', 'fuel', 4, 0],
  ['🛍️', 'Shopping', 'shopping', 5, 1], ['💊', 'Health', 'health', 4, 1, 1], ['🎉', 'Fun', 'entertainment', 5, 1],
  ['💡', 'Utilities', '', 6, 0, 1], ['💪', 'Fitness', 'fitness', 2, 0], ['🐶', 'Pets', 'pets', 2, 0],
  ['💇', 'Personal care', 'personal', 3, 0], ['✈️', 'Travel', 'travel', 4, 0], ['🛠️', 'Home', 'home', 3, 0], ['🎓', 'Education', 'education', 3, 0],
];

// Build categories from picked preset names, with limits suggested from income.
export function fromPresets(names, income) {
  const step = income >= 2000 ? 10 : 5;
  return PRESETS.filter(p => names.includes(p[1])).map(([emoji, name, kind, pct, , essential]) => ({
    id: uid(), emoji, name, rollover: false, kind: kind || undefined, essential: !!essential,
    limit: income > 0 ? Math.round((income * pct) / 100 / step) * step : 0,
  }));
}

// ---- budget math ----
const catKey = (s, t) => (t.type === 'expense' && s.categories.some(c => c.id === t.cat) ? t.cat : '');

export const monthTx = (s, key) => s.transactions.filter(t => t.date.startsWith(key));

function indexSpending(s) {
  const idx = new Map();
  for (const t of s.transactions) {
    if (t.type !== 'expense') continue;
    const k = `${monthOf(t.date)}|${catKey(s, t)}`;
    idx.set(k, (idx.get(k) || 0) + t.amount);
  }
  return idx;
}

/** Income that was actually earned (not money moved back out of the buffer). */
export const isEarned = t => t.type === 'income' && t.src !== 'buffer';
export const limitFor = (s, cat, key) => s.overrides?.[key]?.[cat.id] ?? cat.limit;

export function budgetFor(s, key) {
  const idx = indexSpending(s);
  const spentIn = (m, c) => idx.get(`${m}|${c}`) || 0;
  const cats = s.categories.map(cat => {
    let carry = 0;
    if (cat.rollover && cat.since && cat.since < key) {
      for (let m = cat.since, n = 0; m < key && n < 240; m = addMonths(m, 1), n++) {
        carry = Math.max(0, limitFor(s, cat, m) + carry - spentIn(m, cat.id));
      }
    }
    const spent = round2(spentIn(key, cat.id));
    const limit = limitFor(s, cat, key);
    const avail = round2(limit + carry);
    return { cat, limit, adjusted: limit !== cat.limit, carry: round2(carry), avail, spent, left: round2(avail - spent), pct: avail > 0 ? (spent / avail) * 100 : spent > 0 ? 100 : 0 };
  });
  const uncategorized = round2(spentIn(key, ''));
  const limits = round2(s.categories.reduce((a, c) => a + limitFor(s, c, key), 0));
  const budget = round2(cats.reduce((a, c) => a + c.avail, 0));
  const spent = round2(cats.reduce((a, c) => a + c.spent, 0) + uncategorized);
  const income = round2(monthTx(s, key).filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0));
  const earned = round2(monthTx(s, key).filter(isEarned).reduce((a, t) => a + t.amount, 0));
  return { cats, uncategorized, limits, budget, spent, income, earned, left: round2(budget - spent) };
}

export function trend(s, key, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(key, -i);
    const tx = monthTx(s, m);
    out.push({
      key: m,
      spent: round2(tx.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0)),
      income: round2(tx.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0)),
    });
  }
  return out;
}

// ---- recurring ----
export function advance(r, from = r.next) {
  if (r.freq === 'weekly') return addDays(from, 7);
  if (r.freq === 'biweekly') return addDays(from, 14);
  return dateIn(addMonths(monthOf(from), r.freq === 'yearly' ? 12 : 1), r.anchor);
}

// Adds a transaction for every occurrence that is due on or before `today`. Returns how many were added.
export function generateRecurring(s, today) {
  let added = 0;
  for (const r of s.recurring) {
    for (let n = 0; r.next <= today && n < 1000; n++) {
      s.transactions.push({ id: uid(), type: r.type, amount: r.amount, cat: r.cat, note: r.note, date: r.next, rec: r.id });
      r.next = advance(r);
      added++;
    }
  }
  return added;
}

export const upcoming = (s, today, days = 14) =>
  s.recurring.filter(r => r.next > today && r.next <= addDays(today, days)).sort((a, b) => a.next.localeCompare(b.next));

// ---- export ----
export function toCSV(s) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const name = id => s.categories.find(c => c.id === id)?.name ?? '';
  const rows = [...s.transactions].sort((a, b) => a.date.localeCompare(b.date));
  return ['Date,Type,Category,Note,Merchant,Amount', ...rows.map(t => [t.date, t.type, q(name(t.cat)), q(t.note), q(t.merchant), t.amount.toFixed(2)].join(','))].join('\n');
}


// ---- places & suggestions ----
// What kinds of places a category is meant for: an explicit `kind`, else guessed from its name.
const SYN = {
  grocery: ['grocery', 'groceries', 'supermarket', 'market', 'food'], dining: ['dining', 'restaurant', 'restaurants', 'eating', 'takeout', 'takeaway', 'meals', 'food', 'eat'],
  coffee: ['coffee', 'cafe', 'cafes', 'drinks'], fuel: ['gas', 'fuel', 'petrol'],
  transport: ['transport', 'transportation', 'transit', 'commute', 'car', 'auto', 'parking', 'rideshare', 'taxi'],
  shopping: ['shopping', 'clothes', 'clothing', 'retail', 'stuff'], health: ['health', 'medical', 'pharmacy', 'doctor', 'dental', 'medicine'],
  entertainment: ['fun', 'entertainment', 'movies', 'leisure', 'hobbies', 'recreation', 'games', 'nightlife'], fitness: ['fitness', 'gym', 'sports'],
  home: ['home', 'household', 'garden', 'hardware', 'furniture', 'diy'], pets: ['pet', 'pets', 'dog', 'cat', 'vet'],
  personal: ['personal', 'beauty', 'hair', 'grooming', 'laundry'], travel: ['travel', 'vacation', 'holiday', 'hotel', 'trip', 'trips', 'flights'],
  education: ['education', 'school', 'tuition', 'books', 'learning', 'childcare'], services: ['services'],
};
const FALLBACK = {
  coffee: ['dining'], dining: ['coffee'], fuel: ['transport'], transport: ['fuel'], home: ['shopping'], shopping: ['home'],
  fitness: ['health', 'entertainment'], entertainment: ['fitness'], personal: ['health'], services: ['personal', 'shopping'],
  pets: ['shopping'], education: ['services'], travel: ['entertainment'],
};
export function kindsOf(cat) {
  if (cat.kind) return [cat.kind];
  const words = cat.name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return KINDS.filter(k => SYN[k].some(w => words.includes(w)));
}
// Which of the user's categories a kind of place should map to (or null).
export function catForKind(s, kind) {
  for (const k of [kind, ...(FALLBACK[kind] || [])]) {
    const c = s.categories.find(c => kindsOf(c).includes(k));
    if (c) return c.id;
  }
  return null;
}

// How likely a stop at this kind of place is to involve spending (offices and clinics are mostly just buildings).
const WALK_IN = { grocery: 1.2, dining: 1.2, coffee: 1.2, fuel: 1.2, shopping: 1, home: 1, entertainment: 0.9, pets: 0.9, fitness: 0.8, transport: 0.8, personal: 0.7, travel: 0.6, health: 0.6, education: 0.4, services: 0.4 };

// When people tend to buy what: breaks ties between, say, a café and a restaurant in the same building. hour < 0 = unknown.
const timeFactor = (kind, h) => {
  if (h < 0) return 1;
  if (kind === 'coffee') return h < 11 ? 1.4 : h < 15 ? 0.9 : 0.6;
  if (kind === 'dining') return (h >= 11 && h < 15) || (h >= 17 && h < 22) ? 1.25 : h < 10 ? 0.6 : 0.9;
  if (kind === 'entertainment') return h >= 17 ? 1.2 : 0.9;
  return 1;
};

// Stores whose receipts span several kinds of spending: never trust the brand alone.
export const MULTI = [
  [/walmart|wal-mart/i, { grocery: 0.5, shopping: 0.3, home: 0.2 }, 'walmart'],
  [/\btarget\b/i, { shopping: 0.5, grocery: 0.3, home: 0.2 }, 'target'],
  [/costco/i, { grocery: 0.5, shopping: 0.3, fuel: 0.2 }, 'costco'],
  [/sam'?s club/i, { grocery: 0.5, shopping: 0.3, fuel: 0.2 }, 'sams club'],
  [/bj'?s wholesale/i, { grocery: 0.5, shopping: 0.3, fuel: 0.2 }, 'bjs wholesale'],
  [/\bcvs\b/i, { health: 0.5, shopping: 0.3, grocery: 0.2 }, 'cvs'],
  [/walgreens|duane reade/i, { health: 0.5, shopping: 0.3, grocery: 0.2 }, 'walgreens'],
  [/rite aid/i, { health: 0.5, shopping: 0.3, grocery: 0.2 }, 'rite aid'],
  [/7-eleven|7 eleven|circle k|wawa|sheetz|quiktrip|speedway|casey'?s/i, { fuel: 0.4, grocery: 0.35, coffee: 0.25 }],
];

export const normName = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').replace(/ #?\d+$/, '').trim();
// Departments and branches of the same chain (Walmart Pharmacy, Walmart Supercenter...) share one history.
export const merchantKey = p => {
  const m = MULTI.find(([re]) => re.test(`${p.brand || ''} ${p.name || ''}`));
  return m?.[2] || normName(p.brand || p.name);
};

export function distanceM(lat1, lng1, lat2, lng2) {
  const dy = (lat2 - lat1) * 111320, dx = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

// Pack format: { v:1, name, bbox:[w,s,e,n], kinds:[...], places:[[lat*1e5, lng*1e5, name, kindIndex, brand], ...] }
const CELL = 0.002; // ~220 m
const FUEL_BRANDS = /\b(murphy (usa|express)|shell|exxon|mobil|chevron|conoco|sinclair|valero|phillips 66|bp|texaco|marathon|citgo|sunoco|kum & go|pilot|flying j|love'?s travel)\b/i;
export function buildIndex(pack) {
  const grid = new Map();
  let count = 0;
  for (const r of pack.places || []) {
    let kind = pack.kinds?.[r[3]];
    if (!kind) continue;
    const p = { lat: r[0] / 1e5, lng: r[1] / 1e5, name: String(r[2] || ''), kind, brand: r[4] ? String(r[4]) : '' };
    // Map data often files fuel stops under "convenience store".
    if ((kind === 'grocery' || kind === 'shopping' || kind === 'transport') && FUEL_BRANDS.test(`${p.brand} ${p.name}`)) p.kind = 'fuel';
    if (!p.name) continue;
    const k = `${Math.floor(p.lat / CELL)},${Math.floor(p.lng / CELL)}`;
    (grid.get(k) || grid.set(k, []).get(k)).push(p);
    count++;
  }
  return { grid, count, name: pack.name, label: pack.label, bbox: pack.bbox };
}
export function nearby(index, lat, lng, radiusM) {
  if (!index) return [];
  const out = [], r = Math.ceil(radiusM / 111320 / CELL) + 1, cy = Math.floor(lat / CELL), cx = Math.floor(lng / CELL);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    for (const p of index.grid.get(`${y},${x}`) || []) {
      const d = distanceM(lat, lng, p.lat, p.lng);
      if (d <= radiusM) out.push({ ...p, d });
    }
  }
  return out;
}
export const packCovers = (entry, lat, lng, marginDeg = 0.01) =>
  lng >= entry.bbox[0] - marginDeg && lat >= entry.bbox[1] - marginDeg && lng <= entry.bbox[2] + marginDeg && lat <= entry.bbox[3] + marginDeg;

// Categories for a place, blending built-in defaults with what this user has done there.
function placeCategoryDist(s, cand, amount) {
  const weights = MULTI.find(([re]) => re.test(cand.brand || cand.name))?.[1] ?? { [cand.kind]: 1 };
  const prior = {};
  for (const [kind, w] of Object.entries(weights)) {
    const c = catForKind(s, kind);
    if (c) prior[c] = (prior[c] || 0) + w;
  }
  const m = s.learn.merchants[merchantKey(cand)];
  const K0 = TUNING.k0;
  const out = {};
  const n = m?.n || 0;
  for (const c of new Set([...Object.keys(prior), ...Object.keys(m?.cats || {})])) out[c] = (K0 * Math.min(TUNING.cap, prior[c] || 0) + (m?.cats[c] || 0)) / (K0 + n);
  // At a store that sells everything, what you usually spend per category is a clue: $9 and $180 are different trips.
  if (amount > 0 && m?.lm && Object.keys(out).length > 1) {
    const f = {};
    for (const c of Object.keys(out)) {
      const [k, sum] = m.lm[c] || [0, 0];
      f[c] = k >= 3 ? 0.35 + 0.65 * Math.exp(-0.5 * ((Math.log(amount) - sum / k) / 0.9) ** 2) : 1;
    }
    const before = Object.values(out).reduce((a, b) => a + b, 0);
    const after = Object.keys(out).reduce((a, c) => a + out[c] * f[c], 0);
    if (after > 0) for (const c of Object.keys(out)) out[c] = (out[c] * f[c] * before) / after;
  }
  return out;
}

const nearestSpot = (s, lat, lng, maxM) => {
  let best = null, bd = maxM;
  for (const sp of s.learn.spots) { const d = distanceM(lat, lng, sp.lat, sp.lng); if (d <= bd) { best = sp; bd = d; } }
  return best;
};

// Fallback when we know nothing about where we are: the user's own most-used categories.
function habitual(s) {
  const counts = {};
  for (const t of s.transactions.slice(-80)) if (t.type === 'expense' && t.cat) counts[t.cat] = (counts[t.cat] || 0) + 1;
  return s.categories.map((c, i) => ({ c, n: counts[c.id] || 0, i })).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3).map(x => ({ catId: x.c.id, p: 0 }));
}

// fix: { lat, lng, acc } | null. Returns ranked category guesses and an honest confidence.
export function suggest(s, fix, index, amount = 0, hour = -1) {
  const none = { ranked: habitual(s), conf: 0, margin: 0, place: null, cands: [], acc: fix?.acc ?? null, spot: null };
  if (!fix || !s.categories.length) return none;
  const acc = Math.min(500, Math.max(5, fix.acc || 50)), sigma = Math.max(acc, 20);
  const radius = Math.min(150, Math.max(40, acc * 2));
  const cands = nearby(index, fix.lat, fix.lng, radius).map(c => {
    const m = s.learn.merchants[merchantKey(c)];
    return { ...c, key: merchantKey(c), w: Math.exp(-0.5 * (c.d / sigma) ** 2) * (WALK_IN[c.kind] ?? 1) * timeFactor(c.kind, hour) * (1 + 0.4 * Math.log1p(m?.n || 0)) };
  }).sort((a, b) => b.w - a.w).slice(0, 8);
  const UNKNOWN = TUNING.unknown; // always leave some chance that it's somewhere we don't list
  const total = cands.reduce((a, c) => a + c.w, 0) + UNKNOWN;
  const dist = {};
  for (const c of cands) {
    c.p = c.w / total;
    for (const [cat, p] of Object.entries(placeCategoryDist(s, c, amount))) dist[cat] = (dist[cat] || 0) + c.p * p;
  }
  const spot = nearestSpot(s, fix.lat, fix.lng, Math.max(30, acc));
  let final = dist;
  if (spot) {
    const lam = (spot.n / (spot.n + 3)) * (acc <= 60 ? 1 : 0.7);
    final = {};
    for (const c of new Set([...Object.keys(dist), ...Object.keys(spot.cats)])) final[c] = lam * ((spot.cats[c] || 0) / spot.n) + (1 - lam) * (dist[c] || 0);
  }
  const known = new Set(s.categories.map(c => c.id));
  const ranked = Object.entries(final).filter(([c, p]) => p > 0.02 && known.has(c)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([catId, p]) => ({ catId, p }));
  const penalty = acc <= 50 ? 1 : acc <= 100 ? 0.9 : acc <= 200 ? 0.7 : 0.4;
  const conf = (ranked[0]?.p ?? 0) * penalty;
  const margin = (ranked[0]?.p ?? 0) - (ranked[1]?.p ?? 0);
  // Pad with habitual categories so the review UI can always offer a few one-tap choices.
  for (const h of habitual(s)) if (ranked.length < 3 && !ranked.some(r => r.catId === h.catId)) ranked.push(h);
  return { ranked, conf, margin, place: cands[0] ?? null, cands: cands.slice(0, 3), acc, spot: spot ? { n: spot.n } : null };
}

// The user's setting, nudged up when they have been correcting too many automatic filings.
export function threshold(level, stats) {
  const base = THRESHOLDS[level] ?? THRESHOLDS.balanced;
  const n = (stats?.fixed || 0) + (stats?.confirmed || 0);
  if (n < 10) return base;
  const rate = stats.fixed / n;
  return Math.min(0.97, base + Math.min(0.2, Math.max(0, rate - 0.08) * 1.5));
}
export const correctionRate = stats => { const n = (stats?.fixed || 0) + (stats?.confirmed || 0); return n ? stats.fixed / n : 0; };

// 'auto' only when the guess is confident, clearly ahead of the runner-up, and rests on a decent fix.
export function decide(res, level, fix, stats) {
  if (!fix || !res.ranked.length || !res.ranked[0].p) return 'review';
  if (fix.acc > 150 || (!res.place && !res.spot)) return 'review';
  return res.conf >= threshold(level, stats) && res.margin >= TUNING.margin ? 'auto' : 'review';
}

// ---- learning ----
const SPOT_RADIUS = 30;
export function learnFiling(s, tx, place, fix) {
  if (!tx.cat) return;
  if (place?.key) {
    const m = s.learn.merchants[place.key] ??= { name: place.name, n: 0, cats: {}, amt: 0, lm: {} };
    m.n++; m.cats[tx.cat] = (m.cats[tx.cat] || 0) + 1; m.amt = tx.amount;
    if (tx.amount > 0) { const v = (m.lm ??= {})[tx.cat] ??= [0, 0]; v[0]++; v[1] += Math.log(tx.amount); }
  }
  if (fix) {
    const sp = nearestSpot(s, fix.lat, fix.lng, SPOT_RADIUS);
    if (sp) { sp.n++; sp.cats[tx.cat] = (sp.cats[tx.cat] || 0) + 1; }
    else {
      s.learn.spots.push({ lat: fix.lat, lng: fix.lng, n: 1, cats: { [tx.cat]: 1 } });
      if (s.learn.spots.length > 400) s.learn.spots.sort((a, b) => b.n - a.n).length = 400;
    }
  }
}
export function unlearnFiling(s, tx) {
  if (!tx.cat) return;
  const m = tx.mkey && s.learn.merchants[tx.mkey];
  if (m && m.cats[tx.cat]) {
    m.cats[tx.cat]--; m.n--; if (!m.cats[tx.cat]) delete m.cats[tx.cat];
    const v = m.lm?.[tx.cat];
    if (v) { v[0]--; v[1] -= Math.log(tx.amount || 1); if (v[0] <= 0) delete m.lm[tx.cat]; }
    if (m.n <= 0) delete s.learn.merchants[tx.mkey];
  }
  const sp = tx.loc && nearestSpot(s, tx.loc[0], tx.loc[1], SPOT_RADIUS);
  if (sp && sp.cats[tx.cat]) { sp.cats[tx.cat]--; sp.n--; if (!sp.cats[tx.cat]) delete sp.cats[tx.cat]; if (sp.n <= 0) s.learn.spots.splice(s.learn.spots.indexOf(sp), 1); }
}
export const autoUnconfirmed = (s, today, days = 14) => s.transactions.filter(t => t.auto && t.date >= addDays(today, -days)).sort((a, b) => b.date.localeCompare(a.date));
export const reviewList = s => s.transactions.filter(t => t.status === 'review').sort((a, b) => b.date.localeCompare(a.date));

// Replace one transaction with several, one per part. `parts` is [{amount}] and must add up to the total.
// Returns the resulting transactions in order (the first is the original), or false.
export function splitTx(s, tx, parts) {
  const total = round2(parts.reduce((a, p) => a + p.amount, 0));
  const i = s.transactions.findIndex(t => t.id === tx.id);
  if (i < 0 || parts.length < 2 || parts.some(p => !(p.amount > 0)) || total !== round2(tx.amount)) return false;
  const base = { ...tx };
  delete base.rec; delete base.auto; delete base.status; delete base.sugg;
  base.cat = null;
  const clones = parts.slice(1).map(p => ({ ...base, id: uid(), amount: round2(p.amount) }));
  tx.amount = round2(parts[0].amount);
  s.transactions.splice(i + 1, 0, ...clones);
  return [tx, ...clones];
}


// ---- variable income ----
/** Earned income for each of the `n` completed months before `key`, oldest first. */
export function incomeByMonth(s, key, n = 6) {
  const out = [];
  for (let i = n; i >= 1; i--) {
    const m = addMonths(key, -i);
    out.push({ key: m, earned: round2(monthTx(s, m).filter(isEarned).reduce((a, t) => a + t.amount, 0)) });
  }
  return out;
}

/** A cautious "plan on" income from past months: the average of the lower half. 0 when there is too little history. */
export function baselineIncome(s, key) {
  const months = incomeByMonth(s, key, 6).map(m => m.earned).filter(v => v > 0).sort((a, b) => a - b);
  if (months.length < 2) return 0;
  const low = months.slice(0, Math.ceil(months.length / 2));
  return Math.floor(low.reduce((a, b) => a + b, 0) / low.length / 10) * 10;
}

/** The income the budget is built on. */
export function planIncome(s, key) {
  const st = s.settings;
  if (st.incomeMode !== 'varies') return st.income;
  return st.planOverride > 0 ? st.planOverride : baselineIncome(s, key) || st.income;
}

export function incomeStats(s, key) {
  const vals = incomeByMonth(s, key, 6).map(m => m.earned).filter(v => v > 0);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), avg = round2(vals.reduce((a, b) => a + b, 0) / vals.length);
  return { n: vals.length, min, max, avg, spread: avg ? (max - min) / avg : 0 };
}

/** Where this month stands against the plan. surplus/gap are only positive when meaningful. */
export function incomeStatus(s, key) {
  const plan = planIncome(s, key), b = budgetFor(s, key), earned = b.earned, moved = s.settings.moved[key] || 0;
  const drawn = round2(b.income - earned); // money brought back out of the buffer this month
  return { plan, earned, drawn, moved, surplus: Math.max(0, round2(earned - plan - moved)), gap: Math.max(0, round2(plan - earned - drawn)) };
}

export const bufferGoal = s => s.goals.find(g => g.buffer);

/** Suggested limits for a lean month: essentials are protected, flexible categories share what is left. */
export function leanPlan(s, key, available) {
  const eff = c => limitFor(s, c, key);
  const ess = s.categories.filter(c => c.essential), flex = s.categories.filter(c => !c.essential);
  const eTot = round2(ess.reduce((a, c) => a + eff(c), 0)), fTot = round2(flex.reduce((a, c) => a + eff(c), 0));
  const room = round2(available - eTot);
  const factor = fTot > 0 ? Math.min(1, Math.max(0, room / fTot)) : 1;
  const suggestions = flex.filter(c => eff(c) > 0).map(c => ({ id: c.id, from: eff(c), to: factor >= 1 ? eff(c) : Math.floor((eff(c) * factor) / 5) * 5 }));
  return { available, eTot, fTot, room, factor, shortfall: Math.max(0, -room), suggestions };
}

/** True when there is enough data worth protecting and no recent backup. */
export function backupDue(s, today, days = 30) {
  if (s.transactions.length < 30) return false;
  const last = s.settings.lastBackup;
  return !last || daysBetween(last, today) >= days;
}

/** How far the money received so far stretches: essentials are funded first, then the rest, in list order. */
export function fundingFor(s, key) {
  const b = budgetFor(s, key);
  let pool = round2(b.earned + round2(b.income - b.earned)); // earned income plus anything drawn from the buffer
  const byId = {};
  const order = [...s.categories.filter(c => c.essential), ...s.categories.filter(c => !c.essential)];
  for (const c of order) {
    const need = limitFor(s, c, key);
    const funded = Math.min(need, Math.max(0, pool));
    pool = round2(pool - funded);
    byId[c.id] = { need, funded: round2(funded), short: round2(need - funded) };
  }
  return { byId, unfunded: round2(Object.values(byId).reduce((a, x) => a + x.short, 0)), pool: Math.max(0, pool) };
}

/** True when a new expense is far above what this user usually spends (likely a slipped decimal). */
export function looksTooBig(s, amount) {
  const recent = s.transactions.filter(t => t.type === 'expense').slice(-40).map(t => t.amount).sort((a, b) => a - b);
  if (recent.length < 10 || amount < 200) return null;
  const median = recent[Math.floor(recent.length / 2)];
  return amount >= median * 8 ? { median } : null;
}

/**
 * Spots purchases that repeat on a regular schedule (the same name or place, about the same amount, roughly
 * weekly or monthly) and are not already set up as recurring. Returns suggestions, strongest first.
 */
export function detectRecurring(s, today) {
  const label = t => normName(t.note || t.merchant || '');
  const known = new Set([...s.recurring.map(r => normName(r.note)), ...s.settings.dismissedRecurring]);
  const groups = new Map();
  for (const t of s.transactions) {
    if (t.type !== 'expense' || t.rec) continue;
    const k = label(t);
    if (k.length < 2 || known.has(k)) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    const txs = list.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (txs.length < 3) continue;
    const amounts = txs.map(t => t.amount), avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (amounts.some(a => Math.abs(a - avg) > avg * 0.06)) continue; // same amount each time
    const gaps = txs.slice(1).map((t, i) => daysBetween(txs[i].date, t.date));
    if (gaps.some(g => g < 5)) continue;
    const near = (g, d, tol) => Math.abs(g - d) <= tol;
    let freq = null;
    if (gaps.every(g => near(g, 7, 1))) freq = 'weekly';
    else if (gaps.every(g => near(g, 14, 2))) freq = 'biweekly';
    else if (gaps.every(g => near(g, 30.5, 4))) freq = 'monthly';
    if (!freq) continue;
    const last = txs[txs.length - 1];
    if (daysBetween(last.date, today) > (freq === 'monthly' ? 50 : 25)) continue; // stopped repeating
    const anchor = Number(last.date.slice(8));
    const base = { freq, anchor };
    const next = advance(base, last.date);
    const first = txs[0];
    out.push({ key, note: (last.note || last.merchant).slice(0, 80), amount: round2(avg), cat: last.cat || null, freq, next, count: txs.length, anchor, merchant: last.merchant, first: first.date });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 3);
}
