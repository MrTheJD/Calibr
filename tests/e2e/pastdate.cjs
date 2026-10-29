const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', geolocation: { latitude: 40.75029, longitude: -74.0014, accuracy: 12 }, permissions: ['geolocation'] });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }, { id: 'e', emoji: '🍽️', name: 'Eating out', limit: 100 }] })));
  await p.goto(BASE); await p.waitForSelector('.hero');
  await p.click('#fab'); await p.waitForFunction(() => document.getElementById('sheet').open && document.querySelector('#capture')?.innerText.includes('📍 FAIRWAY MARKET'), null, { timeout: 15000 });
  await p.click('#more summary');
  await p.click('[data-act=setdate][data-d="-1"]');
  await p.waitForFunction(() => document.querySelector('#capture').innerText.includes('another day'));
  assert(!(await p.locator('#capture').innerText()).includes('FAIRWAY'), 'place hidden for a past purchase');
  await p.fill('[name=amount]', '23'); await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  const tx = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('calibr.v2')); return { t: s.transactions[0], learn: s.learn }; });
  assert(!tx.t.loc && !tx.t.merchant && !tx.t.mkey, 'no location stored: ' + JSON.stringify(tx.t));
  assert.strictEqual(Object.keys(tx.learn.merchants).length + tx.learn.spots.length, 0, 'nothing learned from a past purchase');
  console.log('  ✓ a past-dated purchase ignores GPS: nothing stored, nothing learned');
  // today's purchase still uses it
  await p.click('#fab'); await p.waitForFunction(() => document.getElementById('sheet').open && document.querySelector('#capture')?.innerText.includes('📍 FAIRWAY MARKET'), null, { timeout: 15000 });
  await p.fill('[name=amount]', '9'); await p.click('.actions button[value=save]'); await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  const t2 = await p.evaluate(() => JSON.parse(localStorage.getItem('calibr.v2')).transactions.find(t => t.amount === 9));
  assert(t2.merchant === 'FAIRWAY MARKET' && t2.loc, 'today still uses location');
  console.log('  ✓ today’s purchase still uses the location');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('PASTDATE OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
