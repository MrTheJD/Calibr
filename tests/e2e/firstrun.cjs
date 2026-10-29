const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE); await p.waitForSelector('#sheet[open]');
  await p.click('.actions button[value=go]'); // skip income: every limit starts at $0
  await p.waitForSelector('.hero');
  const hero = await p.locator('.hero').innerText();
  assert(!/nice and exact|Budget fully used/.test(hero), 'no misleading congratulation with no limits: ' + hero);
  assert((await p.locator('.card:has-text("Set your monthly limits")').count()) === 1, 'guidance card shown');
  console.log('  ✓ with no limits set, the screen guides instead of congratulating');
  await p.click('[data-act=suggestlimits]'); await p.waitForSelector('#sheet[open] [name=income]');
  await p.fill('[name=income]', '3000');
  assert((await p.locator('#sugglist').innerText()).includes('Groceries $360.00'), await p.locator('#sugglist').innerText());
  await p.click('.actions button[value=save]'); await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert((await p.locator('.card:has-text("Set your monthly limits")').count()) === 0, 'card goes away once limits exist');
  const rows = await p.locator('[data-act=cat]').allInnerTexts();
  assert(rows.some(r => r.includes('Groceries') && r.includes('$360.00')), rows.join(' / '));
  assert((await p.locator('.hero').innerText()).includes('Income $3,000.00'), 'income saved too');
  console.log('  ✓ one step turns income into sensible limits');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('FIRSTRUN OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
