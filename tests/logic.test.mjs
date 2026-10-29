import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const mk = () => {
  const s = L.defaultState();
  s.categories = [
    { id: 'g', emoji: '🛒', name: 'Groceries', limit: 100, rollover: false },
    { id: 'f', emoji: '🎉', name: 'Fun', limit: 50, rollover: true, since: '2026-01' },
  ];
  return s;
};
const tx = (date, amount, cat, type = 'expense') => ({ id: L.uid(), type, amount, cat, note: '', date });

test('v1 saves migrate to v2 and count as onboarded', () => {
  const s = L.migrate({ categories: [{ id: 'a', emoji: '🛒', name: 'Food', limit: 200 }], expenses: [{ id: 'x', amount: 12.5, cat: 'a', note: 'hi', date: '2026-10-02' }] });
  assert.equal(s.v, 2);
  assert.equal(s.settings.onboarded, true);
  assert.equal(s.transactions[0].type, 'expense');
  assert.equal(s.transactions[0].cat, 'a');
});

test('sanitize drops junk and unknown categories', () => {
  const s = L.sanitize({ settings: { currency: 'XXX', theme: 'neon' }, categories: [{ name: ' ' }, { id: 'a', name: 'A', limit: -5 }],
    transactions: [{ amount: 0, date: '2026-01-01' }, { amount: 5, date: 'nope' }, { amount: 5, date: '2026-01-01', cat: 'ghost' }] });
  assert.equal(s.settings.currency, 'USD');
  assert.equal(s.settings.theme, 'auto');
  assert.equal(s.categories.length, 1);
  assert.equal(s.categories[0].limit, 0);
  assert.equal(s.transactions.length, 1);
  assert.equal(s.transactions[0].cat, null);
  assert.equal(L.sanitize(null), null);
});

test('budgetFor totals, uncategorized and income', () => {
  const s = mk();
  s.categories[1].rollover = false;
  s.transactions = [tx('2026-10-01', 30, 'g'), tx('2026-10-02', 0.1, 'g'), tx('2026-10-02', 0.2, 'g'), tx('2026-10-03', 20, null), tx('2026-10-04', 900, null, 'income'), tx('2026-09-30', 99, 'g')];
  const b = L.budgetFor(s, '2026-10');
  assert.equal(b.cats[0].spent, 30.3);
  assert.equal(b.uncategorized, 20);
  assert.equal(b.spent, 50.3);
  assert.equal(b.income, 900);
  assert.equal(b.limits, 150);
  assert.equal(b.left, 99.7);
});

test('rollover carries unspent money forward but not overspending', () => {
  const s = mk();
  s.transactions = [tx('2026-01-05', 20, 'f'), tx('2026-02-05', 80, 'f')];
  assert.equal(L.budgetFor(s, '2026-02').cats[1].carry, 30); // 50 - 20
  assert.equal(L.budgetFor(s, '2026-02').cats[1].avail, 80);
  assert.equal(L.budgetFor(s, '2026-03').cats[1].carry, 0); // overspent Feb: 80 - 80 = 0
  assert.equal(L.budgetFor(s, '2026-04').cats[1].carry, 50); // Mar unspent
  assert.equal(L.budgetFor(s, '2026-05').cats[1].carry, 100); // Mar + Apr unspent
});

test('date helpers', () => {
  assert.equal(L.addMonths('2026-12', 1), '2027-01');
  assert.equal(L.addMonths('2026-01', -1), '2025-12');
  assert.equal(L.daysInMonth('2028-02'), 29);
  assert.equal(L.dateIn('2026-02', 31), '2026-02-28');
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.daysBetween('2026-10-01', '2026-10-15'), 14);
  assert.equal(L.daysLeftInMonth('2026-10-28'), 4);
});

test('monthly recurring keeps its anchor day across short months', () => {
  const s = mk();
  s.recurring = [{ id: 'r', type: 'expense', amount: 10, cat: 'g', note: 'x', freq: 'monthly', next: '2026-01-31', anchor: 31 }];
  const n = L.generateRecurring(s, '2026-03-31');
  assert.equal(n, 3);
  assert.deepEqual(s.transactions.map(t => t.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(s.recurring[0].next, '2026-04-30');
  assert.equal(L.generateRecurring(s, '2026-03-31'), 0); // idempotent
});

test('weekly and yearly recurring', () => {
  const s = mk();
  s.recurring = [
    { id: 'w', type: 'expense', amount: 5, cat: null, note: '', freq: 'weekly', next: '2026-10-01', anchor: 1 },
    { id: 'y', type: 'expense', amount: 5, cat: null, note: '', freq: 'yearly', next: '2024-02-29', anchor: 29 },
  ];
  L.generateRecurring(s, '2026-10-15');
  assert.deepEqual(s.transactions.filter(t => t.rec === 'w').map(t => t.date), ['2026-10-01', '2026-10-08', '2026-10-15']);
  assert.deepEqual(s.transactions.filter(t => t.rec === 'y').map(t => t.date), ['2024-02-29', '2025-02-28', '2026-02-28']);
});

test('upcoming lists only what is due within the window', () => {
  const s = mk();
  s.recurring = [
    { id: 'a', type: 'expense', amount: 1, cat: null, note: 'soon', freq: 'monthly', next: '2026-10-30', anchor: 30 },
    { id: 'b', type: 'expense', amount: 1, cat: null, note: 'far', freq: 'monthly', next: '2026-12-30', anchor: 30 },
  ];
  assert.deepEqual(L.upcoming(s, '2026-10-28', 14).map(r => r.id), ['a']);
});

test('trend covers n months ending at key', () => {
  const s = mk();
  s.transactions = [tx('2026-10-01', 10, 'g'), tx('2026-08-01', 5, 'g'), tx('2026-08-02', 100, null, 'income')];
  const t = L.trend(s, '2026-10', 4);
  assert.deepEqual(t.map(x => x.key), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(t[1].income, 100);
  assert.equal(t[3].spent, 10);
});

test('presets scale to income and carry their kind', () => {
  const t = L.fromPresets(['Housing', 'Groceries'], 3000);
  assert.equal(t.find(c => c.name === 'Housing').limit, 900);
  assert.equal(t.find(c => c.name === 'Groceries').kind, 'grocery');
  assert.equal(L.fromPresets([], 3000).length, 0);
  assert.ok(L.fromPresets(['Fun'], 0).every(c => c.limit === 0));
});

test('csv quotes commas and quotes', () => {
  const s = mk();
  s.transactions = [{ id: '1', type: 'expense', amount: 3, cat: 'g', note: 'say "hi", ok', date: '2026-10-01' }];
  assert.equal(L.toCSV(s).split('\n')[1], '2026-10-01,expense,"Groceries","say ""hi"", ok","",3.00');
});

// ---------- places, suggestions, learning ----------
const state = () => {
  const s = L.defaultState();
  s.categories = L.fromPresets(['Groceries', 'Eating out', 'Coffee', 'Shopping', 'Gas', 'Fun'], 3000);
  return s;
};
const cat = (s, name) => s.categories.find(c => c.name === name).id;
const here = { lat: 40.7580, lng: -73.9855 };
// ~1e-5 degrees of latitude is about 1.1 m
const poi = (name, kind, dLat = 0, brand = '') => [Math.round((here.lat + dLat) * 1e5), Math.round(here.lng * 1e5), name, ['grocery', 'dining', 'coffee', 'fuel', 'shopping', 'health'].indexOf(kind), brand];
const pack = places => ({ v: 1, name: 't', bbox: [-74, 40.7, -73.9, 40.8], kinds: ['grocery', 'dining', 'coffee', 'fuel', 'shopping', 'health'], places });
const fix = (acc = 15) => ({ ...here, acc });

test('category kinds come from names, with fallbacks', () => {
  const s = state();
  assert.equal(L.catForKind(s, 'grocery'), cat(s, 'Groceries'));
  assert.equal(L.catForKind(s, 'dining'), cat(s, 'Eating out'));
  assert.equal(L.catForKind(s, 'fuel'), cat(s, 'Gas'));
  assert.equal(L.catForKind(s, 'health'), null); // no Health category in this budget
  const t = L.defaultState();
  t.categories = [{ id: 'f', name: 'Food', emoji: '🍔', limit: 1 }];
  assert.equal(L.catForKind(t, 'grocery'), 'f');
  assert.equal(L.catForKind(t, 'dining'), 'f');
});

test('index finds places within a radius', () => {
  const idx = L.buildIndex(pack([poi('A', 'grocery', 0.00005), poi('B', 'dining', 0.002)]));
  assert.equal(idx.count, 2);
  assert.deepEqual(L.nearby(idx, here.lat, here.lng, 30).map(p => p.name), ['A']);
  assert.equal(L.nearby(idx, here.lat, here.lng, 400).length, 2);
});

test('a lone nearby supermarket is suggested at first sight but must earn auto-filing', () => {
  const s = state(), idx = L.buildIndex(pack([poi("Trader Joe's", 'grocery', 0.00004)]));
  const r = L.suggest(s, fix(), idx);
  assert.equal(r.ranked[0].catId, cat(s, 'Groceries'));
  assert.equal(r.place.name, "Trader Joe's");
  assert.equal(L.decide(r, 'balanced', fix()), 'review', 'defaults alone are not enough at the default setting');
  assert.equal(L.decide(r, 'eager', fix()), 'auto');
  for (let i = 0; i < 3; i++) L.learnFiling(s, { cat: cat(s, 'Groceries'), amount: 30 }, { key: 'trader joes', name: "Trader Joe's" }, null);
  assert.equal(L.decide(L.suggest(s, fix(), idx), 'balanced', fix()), 'auto', 'three confirmed visits earn it');
});

test('dense area: two different shops in the same spot goes to review with both suggested', () => {
  const s = state(), idx = L.buildIndex(pack([poi('Joe Coffee', 'coffee', 0.00003), poi('Deli Mart', 'grocery', -0.00003)]));
  const r = L.suggest(s, fix(20), idx);
  assert.equal(L.decide(r, 'balanced', fix(20)), 'review');
  const ids = r.ranked.map(x => x.catId);
  assert.ok(ids.includes(cat(s, 'Groceries')) && ids.includes(cat(s, 'Eating out')), 'suggests both candidates');
});

test('walmart needs history before it is auto-filed', () => {
  const s = state(), idx = L.buildIndex(pack([poi('Walmart Supercenter', 'shopping', 0.00003, 'Walmart')]));
  let r = L.suggest(s, fix(), idx);
  assert.equal(L.decide(r, 'balanced', fix()), 'review');
  assert.ok(r.ranked.length >= 2, 'offers alternatives');
  for (let i = 0; i < 8; i++) L.learnFiling(s, { cat: cat(s, 'Groceries'), amount: 50 }, { key: 'walmart', name: 'Walmart' }, null);
  r = L.suggest(s, fix(), idx);
  assert.equal(r.ranked[0].catId, cat(s, 'Groceries'));
  assert.equal(L.decide(r, 'balanced', fix()), 'auto');
  assert.equal(L.decide(r, 'cautious', fix()), 'review'); // the threshold setting matters
  assert.equal(L.decide(L.suggest(s, fix(), idx), 'eager', fix()), 'auto');
});

test('poor GPS accuracy never auto-files', () => {
  const s = state(), idx = L.buildIndex(pack([poi("Trader Joe's", 'grocery', 0.00004)]));
  assert.equal(L.decide(L.suggest(s, fix(300), idx), 'eager', fix(300)), 'review');
  assert.equal(L.decide(L.suggest(s, fix(15), idx), 'eager', fix(15)), 'auto');
});

test('no location or no places: review, with the most-used categories offered', () => {
  const s = state();
  s.transactions = [1, 2, 3].map(() => ({ id: L.uid(), type: 'expense', amount: 5, cat: cat(s, 'Fun'), note: '', date: '2026-10-01' }));
  const r = L.suggest(s, null, null);
  assert.equal(L.decide(r, 'eager', null), 'review');
  assert.equal(r.ranked[0].catId, cat(s, 'Fun'));
  assert.equal(L.decide(L.suggest(s, fix(), null), 'eager', fix()), 'review'); // fix but nothing known here
});

test('a personally learned spot can be trusted without any places data, once it repeats', () => {
  const s = state();
  const f = fix(20);
  for (let i = 0; i < 2; i++) L.learnFiling(s, { cat: cat(s, 'Coffee'), amount: 4 }, null, f);
  assert.equal(L.decide(L.suggest(s, f, null), 'balanced', f), 'review'); // twice is not enough
  for (let i = 0; i < 8; i++) L.learnFiling(s, { cat: cat(s, 'Coffee'), amount: 4 }, null, f);
  const r = L.suggest(s, f, null);
  assert.equal(r.ranked[0].catId, cat(s, 'Coffee'));
  assert.equal(L.decide(r, 'balanced', f), 'auto');
  assert.equal(s.learn.spots.length, 1, 'nearby fixes share one spot');
});

test('unlearn undoes learn', () => {
  const s = state(), g = cat(s, 'Groceries');
  const tx = { cat: g, amount: 9, mkey: 'trader joes', loc: [here.lat, here.lng] };
  L.learnFiling(s, tx, { key: 'trader joes', name: "Trader Joe's" }, here);
  assert.equal(s.learn.merchants['trader joes'].n, 1);
  L.unlearnFiling(s, tx);
  assert.equal(s.learn.merchants['trader joes'], undefined);
  assert.equal(s.learn.spots.length, 0);
});

test('sanitize keeps review state and learned data, drops stale category ids', () => {
  const s = state(), g = cat(s, 'Groceries');
  s.transactions = [{ id: 'a', type: 'expense', amount: 5, cat: null, note: '', date: '2026-10-01', status: 'review', sugg: [g, 'ghost'], merchant: 'X', mkey: 'x', near: ['A', 'B', 'C'], loc: [40.123456, -73.123456] }];
  s.learn.merchants.x = { name: 'X', n: 3, cats: { [g]: 2, ghost: 1 }, amt: 5 };
  const t = L.sanitize(JSON.parse(JSON.stringify(s)));
  assert.equal(t.transactions[0].status, 'review');
  assert.deepEqual(t.transactions[0].sugg, [g]);
  assert.deepEqual(t.transactions[0].loc, [40.1235, -73.1235]);
  assert.deepEqual(t.transactions[0].near, ['A', 'B']);
  assert.deepEqual(t.learn.merchants.x.cats, { [g]: 2 });
  assert.equal(L.reviewList(t).length, 1);
});

test('merchant keys ignore branch numbers and accents', () => {
  assert.equal(L.merchantKey({ name: 'Café Roma #123' }), 'cafe roma');
  assert.equal(L.merchantKey({ name: 'Walmart Supercenter', brand: 'Walmart' }), 'walmart');
  assert.equal(L.merchantKey({ name: "Trader Joe's" }), L.merchantKey({ name: 'Trader Joes' }));
  assert.equal(L.merchantKey({ name: 'McDonald’s' }), 'mcdonalds');
});

test('typical amounts per category break ties at a store that sells everything', () => {
  const s = state(), idx = L.buildIndex(pack([poi('Target', 'shopping', 0.00003, 'Target')]));
  const g = cat(s, 'Groceries'), sh = cat(s, 'Shopping');
  // Past visits: groceries ~ $60, shopping ~ $15
  for (const a of [55, 62, 58, 66, 60, 57]) L.learnFiling(s, { cat: g, amount: a }, { key: 'target', name: 'Target' }, null);
  for (const a of [14, 16, 15, 13]) L.learnFiling(s, { cat: sh, amount: a }, { key: 'target', name: 'Target' }, null);
  const big = L.suggest(s, fix(), idx, 60), small = L.suggest(s, fix(), idx, 14), none = L.suggest(s, fix(), idx, 0);
  assert.equal(big.ranked[0].catId, g);
  assert.equal(small.ranked[0].catId, sh);
  assert.ok(big.ranked[0].p > none.ranked.find(r => r.catId === g).p, 'amount raises the likely category');
  assert.ok(Math.abs(big.ranked.reduce((a, r) => a + r.p, 0) - none.ranked.reduce((a, r) => a + r.p, 0)) < 0.2, 'probability mass is conserved');
});

test('unlearn also removes amount stats', () => {
  const s = state(), g = cat(s, 'Groceries');
  const tx = { cat: g, amount: 40, mkey: 'x' };
  L.learnFiling(s, tx, { key: 'x', name: 'X' }, null);
  L.learnFiling(s, { cat: g, amount: 40 }, { key: 'x', name: 'X' }, null);
  L.unlearnFiling(s, tx);
  assert.equal(s.learn.merchants.x.lm[g][0], 1);
});

test('splitTx divides a purchase and rejects totals that do not add up', () => {
  const s = state(), g = cat(s, 'Groceries'), sh = cat(s, 'Shopping');
  const tx = { id: 't1', type: 'expense', amount: 100, cat: null, note: 'n', date: '2026-10-01', merchant: 'Walmart', mkey: 'walmart' };
  s.transactions = [tx];
  assert.equal(L.splitTx(s, tx, [{ amount: 60 }, { amount: 30 }]), false);
  assert.equal(s.transactions.length, 1);
  const r = L.splitTx(s, tx, [{ amount: 60.1 }, { amount: 39.9 }]);
  assert.equal(s.transactions.length, 2);
  assert.deepEqual(s.transactions.map(t => t.amount), [60.1, 39.9]);
  assert.equal(r.length, 2);
  assert.equal(s.transactions[1].merchant, 'Walmart');
  assert.notEqual(s.transactions[0].id, s.transactions[1].id);
});

test('suggestions never reference a category that no longer exists', () => {
  const s = state(), g = cat(s, 'Groceries');
  for (let i = 0; i < 6; i++) L.learnFiling(s, { cat: g, amount: 20 }, { key: 'x', name: 'X' }, here);
  s.categories = s.categories.filter(c => c.id !== g); // deleted without cleaning learned data
  const idx = L.buildIndex(pack([poi('X', 'grocery', 0.00003)]));
  const r = L.suggest(s, fix(), idx);
  assert.ok(r.ranked.every(x => s.categories.some(c => c.id === x.catId)));
});

test('the threshold rises when the user keeps correcting automatic filings', () => {
  assert.equal(L.threshold('balanced', { fixed: 0, confirmed: 5 }), 0.7); // too little data to judge
  assert.equal(L.threshold('balanced', { fixed: 1, confirmed: 19 }), 0.7); // 5% corrected: fine
  assert.ok(L.threshold('balanced', { fixed: 6, confirmed: 14 }) > 0.8); // 30% corrected: be much more careful
  assert.ok(L.threshold('cautious', { fixed: 20, confirmed: 0 }) <= 0.97);
  assert.equal(L.correctionRate({ fixed: 1, confirmed: 3 }), 0.25);
  // and decide() uses it
  const s = state(), idx = L.buildIndex(pack([poi('A', 'grocery', 0.00004)]));
  for (let i = 0; i < 8; i++) L.learnFiling(s, { cat: cat(s, 'Groceries'), amount: 9 }, { key: 'a', name: 'A' }, null);
  const r = L.suggest(s, fix(), idx);
  assert.equal(L.decide(r, 'balanced', fix(), { fixed: 0, confirmed: 20 }), 'auto');
  assert.equal(L.decide(r, 'balanced', fix(), { fixed: 10, confirmed: 10 }), 'review');
});

test('unconfirmed auto-filed list is recent and newest first', () => {
  const s = state();
  s.transactions = [
    { id: 'a', type: 'expense', amount: 1, cat: cat(s, 'Fun'), note: '', date: '2026-10-27', auto: true },
    { id: 'b', type: 'expense', amount: 1, cat: cat(s, 'Fun'), note: '', date: '2026-10-28', auto: true },
    { id: 'c', type: 'expense', amount: 1, cat: cat(s, 'Fun'), note: '', date: '2026-09-01', auto: true },
    { id: 'd', type: 'expense', amount: 1, cat: cat(s, 'Fun'), note: '', date: '2026-10-28' },
  ];
  assert.deepEqual(L.autoUnconfirmed(s, '2026-10-28').map(t => t.id), ['b', 'a']);
});

// ---------- variable income ----------
const earn = (date, amount, extra = {}) => ({ id: L.uid(), type: 'income', amount, cat: null, note: '', date, ...extra });
const varies = () => { const s = state(); s.settings.incomeMode = 'varies'; return s; };

test('baseline income is the average of the lower half of recent months', () => {
  const s = varies();
  s.transactions = [earn('2026-04-10', 3000), earn('2026-05-10', 2000), earn('2026-06-10', 4000), earn('2026-07-10', 1800), earn('2026-08-10', 3500), earn('2026-09-10', 2500), earn('2026-10-05', 9999)];
  // completed months before Oct: 1800, 2000, 2500, 3000, 3500, 4000 -> lowest 3 = 1800, 2000, 2500 -> 2100
  assert.equal(L.baselineIncome(s, '2026-10'), 2100);
  assert.equal(L.planIncome(s, '2026-10'), 0 || L.planIncome(s, '2026-10'));
  assert.equal(L.planIncome(s, '2026-10'), 2100);
});

test('too little history falls back to the income the user entered; override wins', () => {
  const s = varies();
  s.settings.income = 1500;
  s.transactions = [earn('2026-09-10', 2000)];
  assert.equal(L.baselineIncome(s, '2026-10'), 0);
  assert.equal(L.planIncome(s, '2026-10'), 1500);
  s.settings.planOverride = 1200;
  assert.equal(L.planIncome(s, '2026-10'), 1200);
  s.settings.incomeMode = 'steady';
  assert.equal(L.planIncome(s, '2026-10'), 1500, 'steady mode ignores history and override');
});

test('money moved out of the buffer is not counted as earnings', () => {
  const s = varies();
  s.transactions = [earn('2026-08-10', 2000), earn('2026-08-12', 500, { src: 'buffer' }), earn('2026-09-10', 3000)];
  assert.deepEqual(L.incomeByMonth(s, '2026-10', 3).map(m => m.earned), [2000, 3000].length ? [0, 2000, 3000] : []);
  const b = L.budgetFor(s, '2026-08');
  assert.equal(b.income, 2500);
  assert.equal(b.earned, 2000);
  assert.equal(L.sanitize(JSON.parse(JSON.stringify(s))).transactions[1].src, 'buffer');
});

test('income status reports surplus and gap against the plan, net of what was moved to the buffer', () => {
  const s = varies();
  s.settings.planOverride = 2000;
  s.transactions = [earn('2026-10-02', 2600)];
  let st = L.incomeStatus(s, '2026-10');
  assert.deepEqual([st.plan, st.earned, st.surplus, st.gap], [2000, 2600, 600, 0]);
  s.settings.moved['2026-10'] = 400;
  assert.equal(L.incomeStatus(s, '2026-10').surplus, 200);
  s.transactions = [earn('2026-10-02', 1500)];
  st = L.incomeStatus(s, '2026-10');
  assert.deepEqual([st.surplus, st.gap], [0, 500]);
});

test('income stats describe how much pay varies', () => {
  const s = varies();
  assert.equal(L.incomeStats(s, '2026-10'), null);
  s.transactions = [earn('2026-08-10', 1000), earn('2026-09-10', 3000)];
  const st = L.incomeStats(s, '2026-10');
  assert.deepEqual([st.min, st.max, st.avg, st.n], [1000, 3000, 2000, 2]);
  assert.equal(st.spread, 1);
});

test('one-month limit overrides change that month only, including rollover maths', () => {
  const s = state();
  const g = s.categories.find(c => c.name === 'Groceries');
  g.limit = 400; g.rollover = true; g.since = '2026-08';
  s.overrides = { '2026-09': { [g.id]: 100 } };
  assert.equal(L.budgetFor(s, '2026-09').cats.find(r => r.cat.id === g.id).limit, 100);
  assert.equal(L.budgetFor(s, '2026-10').cats.find(r => r.cat.id === g.id).limit, 400);
  assert.equal(L.budgetFor(s, '2026-09').cats.find(r => r.cat.id === g.id).adjusted, true);
  // Aug: 400 unspent carries; Sep limit is 100 (not 400): carry into Oct = 400 + 100
  assert.equal(L.budgetFor(s, '2026-10').cats.find(r => r.cat.id === g.id).carry, 500);
  const t = L.sanitize(JSON.parse(JSON.stringify(s)));
  assert.equal(t.overrides['2026-09'][g.id], 100);
  t.categories = t.categories.filter(c => c.id !== g.id);
  assert.equal(L.sanitize(JSON.parse(JSON.stringify(t))).overrides['2026-09'], undefined, 'overrides for deleted categories are dropped');
});

test('lean plan protects essentials and scales the rest to what is available', () => {
  const s = state();
  for (const c of s.categories) c.limit = 0;
  const set = (n, v, ess) => { const c = s.categories.find(x => x.name === n); c.limit = v; c.essential = ess; };
  set('Groceries', 500, true); set('Eating out', 200, false); set('Fun', 200, false);
  let p = L.leanPlan(s, '2026-10', 1000);
  assert.equal(p.factor, 1); // 500 essentials + 400 flexible fits in 1000
  assert.equal(p.shortfall, 0);
  p = L.leanPlan(s, '2026-10', 700);
  assert.equal(p.eTot, 500); assert.equal(p.room, 200);
  assert.equal(p.factor, 0.5);
  assert.deepEqual(p.suggestions.map(x => x.to).sort(), [100, 100]);
  p = L.leanPlan(s, '2026-10', 300);
  assert.equal(p.factor, 0);
  assert.equal(p.shortfall, 200, 'essentials alone are not covered');
});

test('presets mark essentials', () => {
  const t = L.fromPresets(['Housing', 'Fun'], 3000);
  assert.equal(t.find(c => c.name === 'Housing').essential, true);
  assert.equal(t.find(c => c.name === 'Fun').essential, false);
});

test('buffer draws cover the gap to the plan but never count as earnings', () => {
  const s = varies();
  s.settings.planOverride = 2000;
  s.transactions = [earn('2026-10-02', 800), earn('2026-10-03', 500, { src: 'buffer' })];
  const st = L.incomeStatus(s, '2026-10');
  assert.deepEqual([st.earned, st.drawn, st.gap, st.surplus], [800, 500, 700, 0]);
});

test('all departments of a big-box chain share one merchant key', () => {
  for (const n of ['Walmart Supercenter', 'Walmart Pharmacy', 'Walmart Neighborhood Market', 'Wal-Mart #12']) assert.equal(L.merchantKey({ name: n }), 'walmart');
  assert.equal(L.merchantKey({ name: "Sam's Club Optical" }), 'sams club');
  assert.equal(L.merchantKey({ name: 'Harps Food Stores' }), 'harps food stores');
});

test('well-known fuel brands filed as convenience stores are treated as fuel stops', () => {
  const s = state();
  const idx = L.buildIndex(pack([poi('Murphy USA', 'grocery', 0.00003), poi('Corner Deli', 'grocery', 0.0004)]));
  const r = L.suggest(s, fix(), idx);
  assert.equal(r.ranked[0].catId, cat(s, 'Gas'));
});

test('backup reminder appears only when there is data worth protecting and no recent backup', () => {
  const s = state();
  assert.equal(L.backupDue(s, '2026-10-28'), false, 'little data');
  s.transactions = Array.from({ length: 40 }, (_, i) => tx('2026-10-01', 5 + i, null));
  assert.equal(L.backupDue(s, '2026-10-28'), true, 'never backed up');
  s.settings.lastBackup = '2026-10-10';
  assert.equal(L.backupDue(s, '2026-10-28'), false);
  assert.equal(L.backupDue(s, '2026-11-15'), true);
  assert.equal(L.sanitize(JSON.parse(JSON.stringify(s))).settings.lastBackup, '2026-10-10');
});

test('time of day breaks ties between stacked places: coffee in the morning, dinner in the evening', () => {
  const s = state(), idx = L.buildIndex(pack([poi('Joe Coffee', 'coffee', 0.00003), poi('Bistro', 'dining', -0.00003)]));
  const morning = L.suggest(s, fix(20), idx, 0, 8), evening = L.suggest(s, fix(20), idx, 0, 19), unknown = L.suggest(s, fix(20), idx, 0);
  assert.equal(morning.ranked[0].catId, cat(s, 'Coffee'));
  assert.equal(evening.ranked[0].catId, cat(s, 'Eating out'));
  assert.ok(unknown.ranked.length >= 2);
});

test('funding goes to essentials first, then the rest in order', () => {
  const s = state();
  for (const c of s.categories) c.limit = 0;
  const set = (n, v, ess) => { const c = s.categories.find(x => x.name === n); c.limit = v; c.essential = ess; };
  set('Eating out', 200, false); set('Groceries', 400, true); set('Fun', 100, false);
  s.transactions = [earn('2026-10-02', 500)];
  let f = L.fundingFor(s, '2026-10');
  assert.deepEqual([f.byId[cat(s, 'Groceries')].funded, f.byId[cat(s, 'Eating out')].funded, f.byId[cat(s, 'Fun')].funded], [400, 100, 0]);
  assert.equal(f.byId[cat(s, 'Fun')].short, 100);
  assert.equal(f.unfunded, 200);
  s.transactions.push(earn('2026-10-03', 400, { src: 'buffer' }));
  f = L.fundingFor(s, '2026-10');
  assert.equal(f.unfunded, 0, 'buffer draws count as money in hand');
  assert.equal(f.pool, 200);
});

test('amounts far above usual spending are flagged, ordinary ones are not', () => {
  const s = state();
  assert.equal(L.looksTooBig(s, 5000), null, 'too little history to judge');
  s.transactions = Array.from({ length: 15 }, (_, i) => tx('2026-10-01', 15 + i, null));
  assert.equal(L.looksTooBig(s, 4500).median, 22);
  assert.equal(L.looksTooBig(s, 150), null, 'below the floor');
  assert.equal(L.looksTooBig(s, 180), null);
  s.transactions.push(...Array.from({ length: 30 }, () => tx('2026-10-02', 300, null)));
  assert.equal(L.looksTooBig(s, 900), null, 'normal for someone who spends in the hundreds');
});
