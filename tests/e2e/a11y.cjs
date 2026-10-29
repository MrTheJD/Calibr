const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8124/';
let axeSrc;
try { axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { console.log('axe-core is not installed; skipping the accessibility audit (npm i --no-save axe-core)'); process.exit(0); }
const pad = n => String(n).padStart(2, '0');
const mk = off => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const state = { v: 2, settings: { onboarded: true, locate: false, incomeMode: 'varies', income: 2000 },
  categories: [{ id: 'h', emoji: '🏠', name: 'Housing', limit: 900, essential: true }, { id: 'g', emoji: '🛒', name: 'Groceries', limit: 400, essential: true }, { id: 'e', emoji: '🍽️', name: 'Eating out', limit: 200 }],
  recurring: [{ id: 'r', type: 'expense', amount: 60, cat: 'e', note: 'Phone', freq: 'monthly', next: today, anchor: 1 }],
  transactions: [...[3000, 2000, 4000].map((a, i) => ({ id: 'i' + i, type: 'income', amount: a, date: mk(i - 4) + '-10', note: 'pay' })), { id: 'n1', type: 'income', amount: 850, date: today, note: 'Week 1' }, { id: 'x1', type: 'expense', amount: 120, cat: 'g', date: today, note: 'Harps', auto: true, merchant: 'Harps' },
    { id: 'rv', type: 'expense', amount: 33.1, cat: null, date: today, note: '', status: 'review', sugg: ['g', 'e'] }],
  goals: [{ id: 'b', emoji: '🛟', name: 'Income buffer', target: 6000, saved: 1250, buffer: true }] };
(async () => {
  const b = await chromium.launch(); const results = {};
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', colorScheme: scheme, reducedMotion: 'reduce' });
    const p = await c.newPage();
    await p.addInitScript(s => localStorage.setItem('calibr.v2', JSON.stringify(s)), state);
    await p.goto(BASE); await p.waitForSelector('.hero');
    await p.addScriptTag({ content: axeSrc });
    const run = async name => { await p.waitForTimeout(250); const r = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0].target.join(' '), html: v.nodes[0].html.slice(0, 110) }))); for (const v of r) (results[`${v.id}|${v.help}`] ??= { impact: v.impact, where: new Set(), sample: v.sample, html: v.html }).where.add(`${scheme}:${name}`); };
    for (const tab of ['budget', 'activity', 'insights', 'goals', 'settings']) { await p.click(`[data-tab=${tab}]`); await run(tab); }
    await p.click('[data-tab=budget]');
    for (const [n, sel] of [['add sheet', '#fab'], ['review', '.banner'], ['cat detail', '[data-act=cat] >> nth=0']]) { await p.click(sel); await run(n); await p.keyboard.press('Escape'); await p.waitForTimeout(100); }
  }
  await b.close();
  const keys = Object.keys(results);
  if (!keys.length) return console.log('no axe violations');
  process.exitCode = 1;
  for (const k of keys) { const r = results[k]; console.log(`[${r.impact}] ${k}\n   where: ${[...r.where].join(', ')}\n   e.g. ${r.sample}\n   ${r.html}`); }
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
