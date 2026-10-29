const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8124/';
const SP = process.env.OUT || require('os').tmpdir();
const FIX = require('path').join(__dirname, '../fixtures/packs');
const fs = require('fs');
const pack = JSON.parse(fs.readFileSync(FIX + '/nwa-test.json'));
const h = pack.places.find(r => /^harps food stores$/i.test(r[2]));
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', geolocation: { latitude: h[0] / 1e5, longitude: h[1] / 1e5, accuracy: 15 }, permissions: ['geolocation'], serviceWorkers: 'allow' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { if (!localStorage.getItem('calibr.v2')) localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }] })); });
  await p.goto(BASE); await p.waitForSelector('.hero');
  // online: open add so the pack gets fetched (and cached by the service worker)
  await p.click('#fab'); await p.waitForFunction(() => document.querySelector('#capture')?.innerText.includes('Harps'), null, { timeout: 15000 });
  await p.keyboard.press('Escape');
  await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(800);
  console.log('service worker controlling page:', await p.evaluate(() => !!navigator.serviceWorker.controller));
  await c.setOffline(true);
  await p.reload(); await p.waitForSelector('.hero', { timeout: 10000 });
  console.log('app loads offline: yes');
  await p.click('#fab'); await p.waitForFunction(() => document.querySelector('#capture')?.innerText.includes('Harps'), null, { timeout: 15000 });
  console.log('places pack works offline: yes —', (await p.locator('#capture').innerText()).split('\n')[0]);
  await p.fill('[name=amount]', '12'); await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  console.log('can log a purchase offline: yes');
  console.log('errors:', errs);
  await b.close();
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
