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
  settings: { currency: 'USD', income: 0, theme: 'auto', onboarded: false, lastCat: null },
  categories: [],
  transactions: [],
  recurring: [],
  goals: [],
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
  };

  s.categories = (Array.isArray(raw.categories) ? raw.categories : [])
    .filter(c => c && typeof c.name === 'string' && c.name.trim())
    .map(c => ({
      id: id(c.id), emoji: str(c.emoji, '🏷️') || '🏷️', name: c.name.trim().slice(0, 40),
      limit: Math.max(0, round2(num(c.limit))), rollover: !!c.rollover,
      since: MONTH.test(c.since) ? c.since : undefined,
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
    }));
  return s;
}
export const migrate = sanitize;

// ---- starter categories ----
const ESSENTIALS = [['🏠', 'Housing', 30], ['🛒', 'Groceries', 12], ['🚗', 'Transport', 10], ['💡', 'Utilities', 6],
  ['🍽️', 'Eating out', 5], ['🎉', 'Fun', 5], ['💊', 'Health', 4], ['🛍️', 'Shopping', 5]];
const FIFTY = [['🏠', 'Needs', 50], ['🎉', 'Wants', 30]];

export function template(name, income) {
  const rows = name === 'blank' ? [] : name === '503020' ? FIFTY : ESSENTIALS;
  const step = income >= 2000 ? 10 : 5;
  return rows.map(([emoji, nm, pct]) => ({
    id: uid(), emoji, name: nm, rollover: false,
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

export function budgetFor(s, key) {
  const idx = indexSpending(s);
  const spentIn = (m, c) => idx.get(`${m}|${c}`) || 0;
  const cats = s.categories.map(cat => {
    let carry = 0;
    if (cat.rollover && cat.since && cat.since < key) {
      for (let m = cat.since, n = 0; m < key && n < 240; m = addMonths(m, 1), n++) {
        carry = Math.max(0, cat.limit + carry - spentIn(m, cat.id));
      }
    }
    const spent = round2(spentIn(key, cat.id));
    const avail = round2(cat.limit + carry);
    return { cat, carry: round2(carry), avail, spent, left: round2(avail - spent), pct: avail > 0 ? (spent / avail) * 100 : spent > 0 ? 100 : 0 };
  });
  const uncategorized = round2(spentIn(key, ''));
  const limits = round2(s.categories.reduce((a, c) => a + c.limit, 0));
  const budget = round2(cats.reduce((a, c) => a + c.avail, 0));
  const spent = round2(cats.reduce((a, c) => a + c.spent, 0) + uncategorized);
  const income = round2(monthTx(s, key).filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0));
  return { cats, uncategorized, limits, budget, spent, income, left: round2(budget - spent) };
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
  return ['Date,Type,Category,Note,Amount', ...rows.map(t => [t.date, t.type, q(name(t.cat)), q(t.note), t.amount.toFixed(2)].join(','))].join('\n');
}
