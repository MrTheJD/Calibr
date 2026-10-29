const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8124/';
const SP = process.env.OUT || require('os').tmpdir();
const FIX = require('path').join(__dirname, '../fixtures/packs');
const assert = require('assert');
const URL = BASE;
const FAIRWAY = { latitude: 40.75029, longitude: -74.0014, accuracy: 12 };
const AMBIG = { latitude: 40.74453, longitude: -73.99686, accuracy: 12 };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-US', geolocation: FAIRWAY, permissions: ['geolocation'], acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/geolocation|Failed to load resource/i.test(m.text()) && errs.push(m.text()));
  const shot = async n => { await p.waitForTimeout(400); await p.screenshot({ path: `${SP}/${n}.png` }); };
  const txt = sel => p.locator(sel).first().innerText();
  const step = n => console.log('  ✓', n);
  const addAt = async (amount, { pick } = {}) => {
    await p.click('#fab');
    await p.waitForSelector('#sheet[open] [name=amount]');
    await p.fill('[name=amount]', String(amount));
    if (pick) await p.locator('#capture .chipbtn', { hasText: pick }).first().click();
  };
  const waitCapture = txt => p.waitForFunction(t => document.getElementById('sheet').open && document.querySelector('#capture')?.innerText.includes(t), txt, { timeout: 15000 });

  await p.goto(URL);
  await p.waitForSelector('#sheet[open]');
  await shot('20-onboarding');
  assert.strictEqual(await p.locator('input[name=cats]:checked').count(), 6, 'six default categories');
  await p.fill('[name=income]', '3000');
  await p.click('.actions button[value=go]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert.strictEqual(await p.locator('[data-act=cat]').count(), 6);
  step('onboarding picks 6 categories');

  // --- earned trust: first visits are one-tap suggestions, then it files by itself
  await p.click('#fab');
  await waitCapture('📍 FAIRWAY MARKET');
  assert((await txt('#capture')).includes('New here?'), await txt('#capture'));
  assert(!(await txt('#capture')).includes('automatically'), 'does not auto-file a brand-new place');
  assert.strictEqual(await p.inputValue('[name=amount]'), '', 'no last amount yet');
  await shot('21-capture-new-place');
  await p.click('.actions button[value=cancel]');
  for (const amt of [31, 27, 35]) {
    await addAt(amt, { pick: 'Groceries' });
    await p.press('[name=amount]', 'Enter');
    await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  }
  step('first three visits: one tap on the suggestion each time');
  await p.click('#fab');
  await waitCapture('📍 FAIRWAY MARKET');
  assert((await txt('#capture')).includes('automatically'), 'earned: ' + await txt('#capture'));
  assert.strictEqual(await p.inputValue('[name=amount]'), '35', 'prefilled with the last amount here');
  await shot('21-capture-confident');
  await p.fill('[name=amount]', '25');
  await p.press('[name=amount]', 'Enter');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert((await txt('#toast')).includes('Filed $25.00 under Groceries · FAIRWAY MARKET'), await txt('#toast'));
  step('fourth visit → auto-filed under Groceries');

  // --- last amount prefilled and selected
  await p.click('#fab');
  await waitCapture('📍 FAIRWAY MARKET');
  assert.strictEqual(await p.evaluate(() => document.activeElement.name), 'amount', 'amount focused');
  await p.fill('[name=amount]', '19');
  await p.press('[name=amount]', 'Enter');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  step('amount field is focused and ready');

  // --- activity shows the auto tag
  await p.click('[data-tab=activity]');
  await p.selectOption('#ftype', 'auto');
  assert.strictEqual(await p.locator('#txlist li').count(), 2);
  await p.selectOption('#ftype', 'all');

  // --- confirm one auto-filed purchase from the check card
  await p.click('[data-tab=budget]');
  assert((await txt('.autocard')).includes('2 purchases filed automatically'));
  await p.click('.autocard');
  await p.waitForSelector('.rv');
  await shot('27-auto-check');
  await p.locator('.rv [data-act=confirm]').first().click();
  assert.strictEqual(await p.locator('.rv').count(), 1, 'one left to check');
  await p.click('.actions button[value=cancel]');

  // --- uncertain: dense spot goes to review
  await ctx.setGeolocation(AMBIG);
  await p.click('[data-tab=budget]');
  await p.click('#fab');
  await waitCapture('±12 m');
  await p.waitForFunction(() => /Chelsea Guitars|El Quijote|T-Mobile/.test(document.querySelector('#capture').innerText));
  assert((await txt('#capture')).includes('Not sure enough'), await txt('#capture'));
  assert(/Near .* or /.test(await txt('#capture')), 'names both nearby places: ' + await txt('#capture'));
  assert((await p.locator('#capture .chipbtn').count()) >= 2, 'offers alternatives');
  await shot('22-capture-uncertain');
  await p.fill('[name=amount]', '12');
  await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert((await txt('#toast')).includes('needs a category'));
  assert((await txt('.banner')).includes('1 purchase needs a category'));
  await shot('23-budget-banner');
  step('dense spot → saved to review, banner shown');

  // --- review: one tap files, undo works
  await p.click('.banner');
  await p.waitForSelector('#sheet[open] .rv');
  await shot('24-review');
  assert((await p.locator('.rv .chipbtn').count()) >= 3);
  assert(/near .* or /.test(await txt('.rv')), 'review row says where it was');
  const first = (await p.locator('.rv [data-act=resolve]').first().innerText()).replace(/\s+/g, ' ').trim();
  await p.locator('.rv [data-act=resolve]').first().click();
  assert((await txt('#sheet')).includes('All caught up'), 'review emptied');
  await p.click('[data-act=rvundo]');
  assert((await p.locator('.rv').count()) === 1, 'undo brings it back');
  await p.locator('.rv [data-act=resolve]').first().click();
  await p.click('.actions button[value=cancel]');
  assert((await p.locator('.banner').count()) === 0, 'banner gone');
  step(`review → one tap files it (${first}); undo works`);

  // --- correcting an auto-filed entry is counted
  await p.click('[data-tab=activity]');
  await p.locator('#txlist li:has-text("📍 auto")').click();
  await p.locator('label:has-text("Eating out") span').click();
  await p.click('.actions button[value=save]');
  await p.click('[data-tab=settings]'); await p.evaluate(() => { const d = document.getElementById('places-details'); if (d) d.open = true; });
  assert((await txt('#view')).includes('2 · 1 confirmed · 1 fixed'), (await txt('#view')).slice(0, 1100));
  assert((await txt('#view')).includes('Midtown Manhattan (demo)'), 'pack status shown');
  step('confirmations and corrections of auto-filed entries are counted; pack status shown');

  // --- learning: repeated explicit choices at a spot become automatic
  await p.click('[data-tab=budget]');
  for (let i = 0; i < 9; i++) {
    await addAt(5 + i, { pick: 'Shopping' });
    await p.click('.actions button[value=save]');
    await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  }
  await p.click('#fab');
  await waitCapture('±12 m');
  await p.waitForFunction(() => document.querySelector('#capture').innerText.includes('automatically'), null, { timeout: 8000 });
  await shot('25-capture-learned');
  await p.click('.actions button[value=cancel]');
  step('after repeated choices the same spot is trusted');

  // --- settings: threshold, location toggle, kinds
  await p.click('[data-tab=settings]');
  await p.selectOption('#s-level', 'cautious');
  await p.uncheck('#s-loc');
  await shot('26-settings');
  await p.reload(); await p.waitForSelector('#view');
  await p.click('[data-tab=settings]');
  assert.strictEqual(await p.inputValue('#s-level'), 'cautious');
  assert.strictEqual(await p.isChecked('#s-loc'), false);
  await p.click('[data-tab=budget]');
  await p.click('#fab');
  await p.waitForSelector('#capture');
  assert((await txt('#capture')).includes('Location is off'));
  await p.click('.actions button[value=cancel]');
  await p.locator('[data-act=cat]').first().click();
  await p.click('[data-act=editcat]');
  assert((await p.locator('#f-kind').count()) === 1, 'place type selector');
  await p.click('.sheetx');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  step('settings persist; location toggle respected');

  // --- csv has merchant
  await p.click('[data-tab=settings]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=exportcsv]')]);
  await dl.saveAs(`${SP}/tx2.csv`);
  const csv = require('fs').readFileSync(`${SP}/tx2.csv`, 'utf8');
  assert(csv.startsWith('Date,Type,Category,Note,Merchant,Amount') && csv.includes('FAIRWAY MARKET'));
  step('CSV export includes merchant');

  assert.deepStrictEqual(errs, [], errs.join('\n'));

  // --- permission denied: everything still works, goes to review
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  await c2.addInitScript(() => { navigator.geolocation.watchPosition = (ok, err) => { setTimeout(() => err({ code: 1 }), 50); return 1; }; navigator.geolocation.getCurrentPosition = (ok, err) => err({ code: 1 }); });
  const q = await c2.newPage(); const e2 = []; q.on('pageerror', e => e2.push(e.message));
  await q.goto(URL); await q.waitForSelector('#sheet[open]');
  await q.click('.actions button[value=go]');
  await q.click('#fab');
  await q.waitForFunction(() => document.querySelector('#capture').innerText.includes('blocked'));
  await q.fill('[name=amount]', '9');
  await q.click('.actions button[value=save]');
  await q.waitForSelector('.banner');
  assert(e2.length === 0, e2.join());
  step('location denied → graceful fallback to review');

  // --- v1 data migrates, no onboarding
  const c3 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const r = await c3.newPage(); const e3 = []; r.on('pageerror', e => e3.push(e.message));
  await r.addInitScript(() => { if (!localStorage.getItem('calibr.v1') && !localStorage.getItem('calibr.v2')) localStorage.setItem('calibr.v1', JSON.stringify({ categories: [{ id: 'a', emoji: '🛒', name: 'Groceries', limit: 400 }], expenses: [{ id: 'x', amount: 42.5, cat: 'a', note: 'Test', date: new Date().toISOString().slice(0, 10) }] })); });
  await r.goto(URL); await r.waitForSelector('.hero');
  assert((await r.locator('#sheet[open]').count()) === 0);
  assert((await r.locator('.hero .big').innerText()).includes('357.50'));
  assert(e3.length === 0, e3.join());
  step('v1 data migrates');

  await b.close();
  console.log('E2E2 OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
