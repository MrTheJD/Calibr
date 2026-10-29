const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8124/';
const SP = process.env.OUT || require('os').tmpdir();
const FIX = require('path').join(__dirname, '../fixtures/packs');
const assert = require('assert');
const URL = BASE;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const today = new Date(); const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await p.addInitScript(([d]) => {
    if (localStorage.getItem('calibr.v2')) return;
    localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, locate: false },
      categories: [{ id: 'a', emoji: '🛒', name: 'Groceries', limit: 400 }, { id: 'b', emoji: '🛍️', name: 'Shopping', limit: 200 }, { id: 'c', emoji: '🛠️', name: 'Home', limit: 100 }],
      transactions: [{ id: 'r1', type: 'expense', amount: 100, cat: null, note: '', date: d, status: 'review', sugg: ['a', 'b'], near: ['Walmart', 'Cafe X'] },
                     { id: 't2', type: 'expense', amount: 30, cat: 'a', note: 'milk', date: d }] }));
  }, [d]);
  const step = n => console.log('  ✓', n);
  const spent = async name => (await p.locator(`[data-act=cat]:has-text("${name}") .small`).first().innerText()).split(' of ')[0];
  await p.goto(URL); await p.waitForSelector('.hero');

  // split from the review list
  await p.click('.banner');
  await p.waitForSelector('.rv');
  await p.click('[data-act=split]');
  await p.waitForSelector('.splitrow');
  await p.fill('.splitrow >> nth=0 >> [name=sa]', '60');
  assert.strictEqual(await p.inputValue('.splitrow >> nth=1 >> [name=sa]'), '40', 'remainder auto-filled');
  assert((await p.locator('#remain').innerText()).includes('Adds up'));
  await p.selectOption('.splitrow >> nth=0 >> [name=sc]', 'a');
  await p.selectOption('.splitrow >> nth=1 >> [name=sc]', 'b');
  await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert.strictEqual(await p.locator('.banner').count(), 0, 'review cleared');
  assert.strictEqual(await spent('Groceries'), '$90.00', 'groceries = 30 + 60');
  assert.strictEqual(await spent('Shopping'), '$40.00');
  step('split from review: $100 → $60 groceries + $40 shopping');

  // split from the edit sheet
  await p.click('[data-tab=activity]');
  await p.locator('#txlist li:has-text("milk")').click();
  await p.click('[data-act=split]');
  await p.waitForSelector('.splitrow');
  await p.fill('.splitrow >> nth=0 >> [name=sa]', '10');
  await p.selectOption('.splitrow >> nth=1 >> [name=sc]', 'c');
  await p.click('[data-act=addsplit]');
  assert.strictEqual(await p.locator('.splitrow').count(), 3, 'can add a third row');
  // mismatch: 10 + 20 + 5 != 30
  await p.fill('.splitrow >> nth=2 >> [name=sa]', '5');
  assert((await p.locator('#remain').innerText()).includes('over'), await p.locator('#remain').innerText());
  await p.click('.actions button[value=save]');
  assert((await p.locator('#sheet[open]').count()) === 1, 'stays open on mismatch');
  assert((await p.locator('#remain').innerText()).includes('add up to'), await p.locator('#remain').innerText());
  await p.fill('.splitrow >> nth=2 >> [name=sa]', '');
  await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  await p.click('[data-tab=budget]');
  assert.strictEqual(await spent('Home'), '$20.00');
  assert.strictEqual(await spent('Groceries'), '$70.00', '60 + 10');
  step('split from edit sheet; mismatched totals are rejected inline');

  // totals unchanged overall
  assert((await p.locator('.hero .sub').first().innerText()).includes('$130.00 spent'));
  step('overall spending unchanged by splitting ($130)');

  // open straight to add
  await p.click('[data-tab=settings]');
  assert.strictEqual(await p.locator('a[href*="build-pack"]').count(), 0, 'no pack link off github.io');
  await p.check('#s-quick');
  await p.reload();
  await p.waitForSelector('#sheet[open] [name=amount]');
  await p.waitForFunction(() => document.activeElement.name === 'amount', null, { timeout: 3000 });
  step('open-straight-to-Add focuses the amount');

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('E2E3 OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
