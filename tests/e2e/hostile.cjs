const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8124/';
const evil = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const hostile = { v: 2, settings: { onboarded: true, locate: false, currency: evil, theme: evil, lastCat: evil, level: evil, incomeMode: evil, dismissedRecurring: [evil] },
  categories: [{ id: evil, emoji: '<img src=x onerror=window.__pwned=3>', name: evil, limit: 100, essential: true, kind: evil }, { id: 'ok', emoji: '🛒', name: '<b>bold</b>', limit: 50 }],
  goals: [{ id: evil, emoji: evil, name: evil, target: 100, saved: 10, date: evil }],
  recurring: [{ id: evil, type: 'expense', amount: 5, cat: evil, note: evil, freq: 'monthly', next: today }],
  transactions: [{ id: evil, type: 'expense', amount: 9, cat: evil, note: evil, merchant: evil, near: [evil, evil], date: today, status: 'review', sugg: [evil, 'ok'] }, { id: 'b', type: 'expense', amount: 4, cat: 'ok', note: evil, merchant: evil, mkey: evil, date: today, auto: true }],
  learn: { merchants: { [evil]: { name: evil, n: 1, cats: { ok: 1 } } }, spots: [], stats: { auto: 1, fixed: 0, confirmed: 0 } }, overrides: { [evil]: { ok: 5 } } };
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const clean = async where => { const r = await p.evaluate(() => ({ pwned: window.__pwned, injected: document.querySelectorAll('img[src="x"], script:not([type=module]):not([src])').length })); assert(!r.pwned && r.injected === 0, `${where}: ${JSON.stringify(r)}`); };
  // 1) hostile data already in storage
  await p.addInitScript(h => localStorage.setItem('calibr.v2', JSON.stringify(h)), hostile);
  await p.goto(BASE); await p.waitForSelector('#view');
  for (const tab of ['budget', 'activity', 'insights', 'goals', 'settings']) { await p.click(`[data-tab=${tab}]`); await p.waitForTimeout(150); await clean(tab); }
  await p.click('[data-tab=budget]');
  for (const sel of ['#fab', '.banner', '[data-act=cat] >> nth=0']) { await p.click(sel); await p.waitForTimeout(200); await clean(sel); await p.keyboard.press('Escape'); }
  console.log('  ✓ hostile data in storage renders as plain text on every screen and sheet');
  // 2) hostile data arriving through "Restore from backup"
  const file = path.join(os.tmpdir(), 'hostile-backup.json'); fs.writeFileSync(file, JSON.stringify(hostile));
  await p.evaluate(() => localStorage.clear()); await p.addInitScript(() => {}); 
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' }); const q = await c2.newPage(); q.on('dialog', d => d.accept());
  await q.addInitScript(() => localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true } })));
  await q.goto(BASE); await q.waitForSelector('#view'); await q.click('[data-tab=settings]'); await q.setInputFiles('#file', file); await q.waitForFunction(() => (JSON.parse(localStorage.getItem('calibr.v2')).categories || []).length > 0, null, { timeout: 5000 });
  for (const tab of ['budget', 'activity', 'goals']) { await q.click(`[data-tab=${tab}]`); await q.waitForTimeout(150); const r = await q.evaluate(() => ({ pwned: window.__pwned, injected: document.querySelectorAll('img[src="x"]').length })); assert(!r.pwned && !r.injected, 'after restore ' + tab); }
  const stored = await q.evaluate(() => JSON.parse(localStorage.getItem('calibr.v2')));
  assert(stored.categories.every(x => /^[A-Za-z0-9_-]+$/.test(x.id)), 'ids cleaned');
  console.log('  ✓ restoring a hostile backup is just as harmless');
  assert.deepStrictEqual(errs, []); assert.deepStrictEqual(dialogs, []);
  await b.close(); console.log('HOSTILE OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
