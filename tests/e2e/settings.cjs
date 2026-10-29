const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, seenVersion: '1.4.0' }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }] })));
  await p.goto(BASE); await p.waitForSelector('#view'); await p.click('[data-tab=settings]');
  for (const sel of ['#s-mode', '#s-cur', '#s-loc', '#s-quick', '#s-level', '[data-act=addrec]', '[data-act=exportjson]', '[data-act=reset]']) assert(await p.locator(sel).isVisible(), sel + ' is visible without opening anything');
  assert(!(await p.locator('[data-act=diag]').isVisible()), 'rarely used tools start collapsed');
  console.log('  ✓ everyday settings are visible; places & learning starts collapsed');
  await p.click('#places-details summary');
  assert(await p.locator('[data-act=diag]').isVisible() && await p.locator('[data-act=forget]').isVisible());
  await p.selectOption('#s-cur', 'EUR');            // changing a setting re-renders the screen
  assert(await p.locator('[data-act=diag]').isVisible(), 'stays open after a re-render');
  await p.click('[data-tab=budget]'); await p.click('[data-tab=settings]');
  assert(await p.locator('[data-act=diag]').isVisible(), 'and across tab switches');
  console.log('  ✓ the group remembers that you opened it');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('SETTINGS OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
