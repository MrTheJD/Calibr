const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  await p.addInitScript(([day]) => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, locate: false }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }, { id: 'c', emoji: '☕', name: 'Coffee', limit: 50 }],
    transactions: [['Harps', 'g'], ['Harps', 'g'], ['Aldi', 'g'], ['Daily Grind', 'c'], ['Daily Grind', 'c'], ['Daily Grind', 'c']].map(([n, cat], i) => ({ id: 't' + i, type: 'expense', amount: 10 + i, cat, note: n, date: day })) })), [day]);
  await p.goto(BASE); await p.waitForSelector('.hero');
  await p.click('#fab'); await p.waitForSelector('#capture .chipbtn');
  const labels = await p.locator('#capture [data-act=recent]').allInnerTexts();
  assert(labels.length === 3 && labels[0].includes('Daily Grind'), 'most frequent first: ' + labels);
  await p.click('#capture [data-act=recent]:has-text("Harps")');
  assert.strictEqual(await p.inputValue('[name=note]'), 'Harps');
  assert((await p.locator('#capture').innerText()).includes('filed under Groceries'), await p.locator('#capture').innerText());
  await p.fill('[name=amount]', '42'); await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert((await p.locator('[data-act=cat]:has(.title:text-is("Groceries"))').innerText()).includes('$75.00')); // 11+12+... 
  console.log('  ✓ recent chips fill note and category in one tap');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('RECENT OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
