import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

// Seeded random operations against the engine; checks invariants rather than specific outputs.
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, a) => a[Math.floor(r() * a.length)];
const NAMES = ['Walmart Supercenter', "Trader Joe's", 'Starbucks', 'Murphy USA', 'Harps Food Stores', 'Corner Cafe', 'CVS Pharmacy', 'Gym', 'Cinema'];
const KINDS = ['grocery', 'dining', 'coffee', 'fuel', 'shopping', 'health', 'entertainment', 'fitness'];

function world(r) {
  const s = L.defaultState();
  s.categories = L.fromPresets(['Groceries', 'Eating out', 'Coffee', 'Shopping', 'Gas', 'Fun', 'Health', 'Housing'].filter(() => r() > 0.2), 3000);
  const places = Array.from({ length: 60 }, () => [Math.round((36.3 + r() * 0.01) * 1e5), Math.round((-94.2 + r() * 0.01) * 1e5), pick(r, NAMES) + (r() > 0.5 ? ' #' + Math.floor(r() * 99) : ''), Math.floor(r() * KINDS.length), r() > 0.7 ? pick(r, NAMES) : '']);
  const anchors = places.slice(0, 6);
  return { anchors, s, idx: L.buildIndex({ v: 1, name: 'f', bbox: [-94.3, 36.2, -94.1, 36.4], kinds: KINDS, places }) };
}

test('random operations never throw and keep the state valid', () => {
  const seen = { auto: 0, review: 0, explicit: 0, income: 0, unlearn: 0, split: 0, delcat: 0, override: 0, read: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 101);
    const { s, idx, anchors } = world(r);
    s.settings.incomeMode = r() > 0.5 ? 'varies' : 'steady';
    for (let step = 0; step < 120; step++) {
      const op = Math.floor(r() * 9);
      const a = pick(r, anchors); // people revisit the same few places, usually with a decent GPS fix
      const fix = r() < 0.75 ? { lat: a[0] / 1e5 + (r() - 0.5) * 0.0002, lng: a[1] / 1e5 + (r() - 0.5) * 0.0002, acc: 5 + r() * 40 } : { lat: 36.3 + r() * 0.01, lng: -94.2 + r() * 0.01, acc: 5 + r() * 300 };
      const cats = s.categories;
      if (op <= 2 && cats.length) { // a purchase, filed or reviewed according to the engine
        const amount = Math.round((1 + r() * 200) * 100) / 100;
        const res = L.suggest(s, r() > 0.1 ? fix : null, idx, amount);
        assert.ok(res.ranked.every(x => cats.some(c => c.id === x.catId)), 'suggestions reference real categories');
        assert.ok(res.conf >= 0 && res.conf <= 1.0001, `conf in range: ${res.conf}`);
        const d = L.decide(res, pick(r, ['cautious', 'balanced', 'eager']), fix, s.learn.stats);
        const t = { id: L.uid(), type: 'expense', amount, cat: null, note: '', date: `2026-${String(1 + Math.floor(r() * 10)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}` };
        if (res.place && res.place.p >= 0.35) { t.merchant = res.place.name; t.mkey = res.place.key; }
        t.loc = [fix.lat, fix.lng];
        s.transactions.push(t);
        seen[d === 'auto' ? 'auto' : r() > 0.5 ? 'explicit' : 'review']++;
        if (d === 'auto' || r() > 0.5) { t.cat = res.ranked[0].catId; L.learnFiling(s, t, t.mkey ? { key: t.mkey, name: t.merchant } : null, fix); if (d === 'auto') t.auto = true; }
        else { t.status = 'review'; t.sugg = res.ranked.map(x => x.catId); }
      } else if (op === 3) { seen.income++; // income, sometimes drawn from the buffer
        s.transactions.push({ id: L.uid(), type: 'income', amount: Math.round(100 + r() * 3000), cat: null, note: '', date: `2026-${String(1 + Math.floor(r() * 10)).padStart(2, '0')}-10`, ...(r() > 0.8 ? { src: 'buffer' } : {}) });
      } else if (op === 4) { // unlearn + delete
        const t = pick(r, s.transactions);
        if (t) { seen.unlearn++; L.unlearnFiling(s, t); s.transactions = s.transactions.filter(x => x !== t); }
      } else if (op === 5) { // split
        const t = pick(r, s.transactions.filter(x => x.type === 'expense' && x.amount >= 2));
        if (t && cats.length) {
          const a = Math.floor(t.amount * 100 * (0.2 + r() * 0.6)) / 100, before = L.round2(t.amount);
          if (t.cat) L.unlearnFiling(s, t);
          t.cat = null;
          const parts = L.splitTx(s, t, [{ amount: a }, { amount: L.round2(before - a) }]);
          if (parts) { seen.split++; assert.equal(L.round2(parts.reduce((x, p) => x + p.amount, 0)), before, 'split preserves the total'); parts.forEach(p => { p.cat = pick(r, cats).id; L.learnFiling(s, p, null, null); }); }
        }
      } else if (op === 6 && cats.length > 1) { // delete a category, the way the app does
        const c = pick(r, cats); seen.delcat++;
        s.categories = s.categories.filter(x => x.id !== c.id);
        s.transactions.forEach(t => { if (t.cat === c.id) t.cat = null; });
        Object.assign(s, L.sanitize(JSON.parse(JSON.stringify(s))));
      } else if (op === 7 && cats.length) { // month-only limit
        const m = `2026-${String(1 + Math.floor(r() * 10)).padStart(2, '0')}`;
        seen.override++; (s.overrides[m] ??= {})[pick(r, cats).id] = Math.floor(r() * 500);
      } else if (op === 8) { // exercise the readers
        const m = `2026-${String(1 + Math.floor(r() * 10)).padStart(2, '0')}`;
        seen.read++;
        const b = L.budgetFor(s, m);
        assert.ok(Number.isFinite(b.left) && Number.isFinite(b.spent) && Number.isFinite(b.budget));
        const st = L.incomeStatus(s, m);
        assert.ok(st.surplus >= 0 && st.gap >= 0 && !(st.surplus > 0 && st.gap > 0), 'surplus and gap are never both positive');
        L.leanPlan(s, m, r() * 3000); L.trend(s, m, 6); L.upcoming(s, m + '-15', 14); L.toCSV(s); L.baselineIncome(s, m); L.incomeStats(s, m);
      }
    }
    // sanitizing is stable (idempotent) and never loses transactions
    const once = L.sanitize(JSON.parse(JSON.stringify(s)));
    const twice = L.sanitize(JSON.parse(JSON.stringify(once)));
    assert.deepEqual(twice, once, `sanitize is idempotent (seed ${seed})`);
    assert.equal(once.transactions.length, s.transactions.length, 'no transaction lost');
    // learned counts stay consistent
    for (const m of Object.values(once.learn.merchants)) assert.equal(Object.values(m.cats).reduce((a, b) => a + b, 0), m.n);
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 20, `operation '${k}' was exercised (${v})`);
});
