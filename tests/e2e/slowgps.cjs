const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
const FAIRWAY = { latitude: 40.75029, longitude: -74.0014, accuracy: 12 };
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', geolocation: FAIRWAY, permissions: ['geolocation'] });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  // A cold GPS: the first fix takes 1.2 s to arrive.
  await p.addInitScript(() => {
    const orig = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    navigator.geolocation.watchPosition = (ok, err, o) => orig(pos => setTimeout(() => ok(pos), 1200), err, o);
    if (!localStorage.getItem('calibr.v2')) localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }, { id: 'e', emoji: '🍽️', name: 'Eating out', limit: 100 }] }));
  });
  await p.goto(BASE); await p.waitForSelector('.hero');
  // open, type, and save at once, before the fix exists
  await p.click('#fab'); await p.waitForSelector('#sheet[open] [name=amount]');
  await p.fill('[name=amount]', '18.40');
  const t0 = Date.now();
  await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached', timeout: 6000 });
  const waited = Date.now() - t0;
  console.log('  ✓ save waited for the first fix:', waited, 'ms');
  assert(waited >= 900 && waited < 4000, 'waited ' + waited);
  await p.click('[data-tab=activity]');
  const row = await p.locator('#txlist li').first().innerText();
  assert(row.includes('FAIRWAY MARKET'), 'purchase kept its place: ' + row);
  console.log('  ✓ the purchase kept its place:', row.replace(/\n/g, ' | '));
  // and when there is no fix at all it still saves after the short wait
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const q = await c2.newPage();
  await q.addInitScript(() => { navigator.geolocation.watchPosition = () => 1; navigator.geolocation.clearWatch = () => {}; localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }] })); });
  await q.goto(BASE); await q.waitForSelector('.hero');
  await q.click('#fab'); await q.fill('[name=amount]', '5'); const t1 = Date.now(); await q.click('.actions button[value=save]');
  await q.waitForSelector('#sheet:not([open])', { state: 'attached', timeout: 6000 });
  const w2 = Date.now() - t1; assert(w2 >= 1700 && w2 < 4500, 'no-fix wait ' + w2);
  console.log('  ✓ with no GPS at all it still saves after', w2, 'ms');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('SLOWGPS OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
