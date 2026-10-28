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

test('a lone nearby supermarket is auto-filed as Groceries', () => {
  const s = state(), idx = L.buildIndex(pack([poi("Trader Joe's", 'grocery', 0.00004)]));
  const r = L.suggest(s, fix(), idx);
  assert.equal(r.ranked[0].catId, cat(s, 'Groceries'));
  assert.equal(r.place.name, "Trader Joe's");
  assert.ok(r.conf >= 0.8, `conf ${r.conf}`);
  assert.equal(L.decide(r, 'balanced', fix()), 'auto');
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
});
