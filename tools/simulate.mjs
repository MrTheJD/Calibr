// Synthetic-user simulation of Calibr auto-filing on a real places pack.
// usage: node tools/simulate.mjs packs/<pack>.json [gpsSigmaMeters=15] [visits=300] [users=20] [userQuirkRate=0.1]
// Reports, per threshold, how much is auto-filed and how much of that is wrong. TUNE='{"cap":0.65}' overrides model knobs.
import fs from 'fs';
import * as L from '../logic.js';
if (process.env.TUNE) Object.assign(L.TUNING, JSON.parse(process.env.TUNE));
const QUIRK = +(process.argv[6] ?? 0.1);
const packFile = process.argv[2], sigma = +process.argv[3] || 15, visits = +process.argv[4] || 300, seeds = +process.argv[5] || 20;
const pack = JSON.parse(fs.readFileSync(packFile));
const idx = L.buildIndex(pack);
const all = []; for (const g of idx.grid.values()) all.push(...g);
// rng
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const AMT = { Groceries: 55, 'Eating out': 25, Coffee: 6, Shopping: 40, Gas: 45, Fun: 30, Health: 25 };
const KIND_CAT = { grocery: 'Groceries', dining: 'Eating out', coffee: 'Coffee', shopping: 'Shopping', fuel: 'Gas', entertainment: 'Fun', health: 'Health' };
const KIND_ALT = { grocery: 'Eating out', dining: 'Groceries', coffee: 'Eating out', shopping: 'Fun', fuel: 'Shopping', entertainment: 'Eating out', health: 'Shopping' };

function run(level, seed) {
  const r = mulberry(seed);
  const s = L.defaultState();
  s.categories = L.fromPresets(Object.keys(AMT), 3000);
  const id = n => s.categories.find(c => c.name === n).id;
  // places the user can plausibly visit: spending-relevant kinds only; pick a home area then habits
  const pool = all.filter(p => KIND_CAT[p.kind]);
  const c0 = pool[Math.floor(r() * pool.length)];
  const near = pool.filter(p => L.distanceM(c0.lat, c0.lng, p.lat, p.lng) < 1500);
  const habits = Array.from({ length: 25 }, () => near[Math.floor(r() * near.length)]);
  const stats = { auto: 0, wrong: 0, review: 0, n: 0, early: { auto: 0, wrong: 0, n: 0 }, late: { auto: 0, wrong: 0, n: 0 } };
  for (let i = 0; i < visits; i++) {
    const p = r() < 0.8 ? habits[Math.min(habits.length - 1, Math.floor(-Math.log(1 - r() * 0.95) * 6))] : near[Math.floor(r() * near.length)];
    // what the user would truly file this as
    let trueCat;
    const multi = L.MULTI.find(([re]) => re.test(p.brand || p.name));
    if (multi) { let x = r(), acc = 0; for (const [k, w] of Object.entries(multi[1])) { acc += w; if (x <= acc) { trueCat = KIND_CAT[k]; break; } } trueCat ??= 'Shopping'; }
    else trueCat = r() >= QUIRK ? KIND_CAT[p.kind] : KIND_ALT[p.kind];
    const amount = Math.round(AMT[trueCat] * Math.exp(gauss(r) * 0.5) * 100) / 100;
    const noise = () => gauss(r) * sigma / 111320;
    const fix = { lat: p.lat + noise(), lng: p.lng + noise() / Math.cos(p.lat * Math.PI / 180), acc: Math.max(8, sigma * 1.5) };
    const res = L.suggest(s, fix, idx, amount);
    const d = L.decide(res, level, fix);
    stats.n++; const early = i < 60, late = i >= 150; if (late) stats.late.n++;
    if (early) stats.early.n++;
    const place = res.place && res.place.p >= 0.35 ? { key: res.place.key, name: res.place.name } : null;
    if (d === 'auto') {
      stats.auto++; if (early) stats.early.auto++; if (late) stats.late.auto++;
      const guess = s.categories.find(c => c.id === res.ranked[0].catId).name;
      if (guess !== trueCat) { stats.wrong++; if (early) stats.early.wrong++; if (late) stats.late.wrong++; }
      // a wrong auto-filing is noticed and corrected some of the time; assume the user fixes 50% of them
      const filed = guess !== trueCat && r() < 0.5 ? trueCat : guess;
      L.learnFiling(s, { cat: id(filed), amount }, place, fix);
    } else { stats.review++; L.learnFiling(s, { cat: id(trueCat), amount }, place, fix); } // review → user picks the truth
  }
  return stats;
}
const rows = [];
for (const level of ['cautious', 'balanced', 'eager']) {
  const t = { auto: 0, wrong: 0, review: 0, n: 0, early: { auto: 0, wrong: 0, n: 0 }, late: { auto: 0, wrong: 0, n: 0 } };
  for (let sd = 1; sd <= seeds; sd++) { const x = run(level, sd * 7919); for (const k of ['auto', 'wrong', 'review', 'n']) t[k] += x[k]; for (const k of ['auto', 'wrong', 'n']) { t.early[k] += x.early[k]; t.late[k] += x.late[k]; } }
  rows.push(`${level.padEnd(9)} auto-filed ${(100 * t.auto / t.n).toFixed(0).padStart(3)}%   of those wrong ${(100 * t.wrong / Math.max(1, t.auto)).toFixed(1).padStart(4)}%  | to review ${(100 * t.review / t.n).toFixed(0).padStart(3)}% | first 60: auto ${(100 * t.early.auto / t.early.n).toFixed(0)}% wrong ${(100 * t.early.wrong / Math.max(1, t.early.auto)).toFixed(1)}% | steady: auto ${(100 * t.late.auto / t.late.n).toFixed(0)}% wrong ${(100 * t.late.wrong / Math.max(1, t.late.auto)).toFixed(1)}%`);
}
console.log(`${packFile.split('/').pop()}  GPS sigma ${sigma} m  ${visits} visits x ${seeds} users`); console.log(rows.join('\n'));
