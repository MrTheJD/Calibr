const { chromium, devices } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const seed = () => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }] }));
  // iPhone Safari (not installed): the card appears, and stays dismissed
  const c = await b.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(seed); await p.goto(BASE); await p.waitForSelector('.hero');
  assert((await p.locator('.card:has-text("Add Calibr to your Home Screen")').count()) === 1, 'card shown on iPhone Safari');
  await p.click('[data-act=dismissinstall]');
  assert((await p.locator('.card:has-text("Add Calibr to your Home Screen")').count()) === 0);
  await p.reload(); await p.waitForSelector('.hero');
  assert((await p.locator('.card:has-text("Add Calibr to your Home Screen")').count()) === 0, 'stays dismissed');
  console.log('  ✓ iPhone Safari sees the install card once; dismissing sticks');
  // everything else: no card
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const q = await c2.newPage(); await q.addInitScript(seed); await q.goto(BASE); await q.waitForSelector('.hero');
  assert((await q.locator('.card:has-text("Add Calibr to your Home Screen")').count()) === 0, 'not shown elsewhere');
  console.log('  ✓ not shown on other browsers');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('INSTALL OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
