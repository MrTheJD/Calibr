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

test('templates scale to income and blank is empty', () => {
  const t = L.template('essentials', 3000);
  assert.equal(t.find(c => c.name === 'Housing').limit, 900);
  assert.equal(L.template('blank', 3000).length, 0);
  assert.ok(L.template('essentials', 0).every(c => c.limit === 0));
});

test('csv quotes commas and quotes', () => {
  const s = mk();
  s.transactions = [{ id: '1', type: 'expense', amount: 3, cat: 'g', note: 'say "hi", ok', date: '2026-10-01' }];
  assert.equal(L.toCSV(s).split('\n')[1], '2026-10-01,expense,"Groceries","say ""hi"", ok",3.00');
});
