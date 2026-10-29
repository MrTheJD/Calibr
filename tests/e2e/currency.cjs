const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const state = cur => ({ v: 2, settings: { onboarded: true, locate: false, currency: cur, income: 987654321, incomeMode: 'steady' },
  categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 123456789 }, { id: 'h', emoji: '🏠', name: 'A very long category name for housing and utilities', limit: 500000000, essential: true }],
  goals: [{ id: 'b', emoji: '🎯', name: 'Big goal', target: 9999999999, saved: 1234567890 }],
  transactions: [{ id: 't1', type: 'expense', amount: 98765432.1, cat: 'g', date: day, note: 'Huge' }, { id: 't2', type: 'income', amount: 987654321, date: day, note: 'Pay' }] });
(async () => {
  const b = await chromium.launch(); const errs = [];
  // Yen: no decimals anywhere, enormous numbers still fit at 320px
  const c = await b.newContext({ viewport: { width: 320, height: 640 }, locale: 'ja-JP' });
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'body,button,input,select{font-family:"DejaVu Sans Mono","Liberation Mono",monospace !important}'; document.head.append(st); })); // wide glyphs: the worst case for fitting numbers
  await p.addInitScript(s => localStorage.setItem('calibr.v2', JSON.stringify(s)), state('JPY'));
  await p.goto(BASE); await p.waitForSelector('.hero');
  const hero = await p.locator('.hero').innerText();
  assert(/[¥￥]/.test(hero) && !/\.\d\d/.test(hero), 'yen has no decimals: ' + hero);
  for (const tab of ['budget', 'activity', 'insights', 'goals', 'settings']) {
    await p.click(`[data-tab=${tab}]`); await p.waitForTimeout(150);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(over <= 1, `${tab}: page overflows by ${over}px with huge yen amounts`);
  }
  await p.click('[data-tab=budget]'); await p.click('#fab'); await p.fill('[name=amount]', '1500'); await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  console.log('  ✓ yen: no decimals, huge amounts fit a 320px screen on every tab');
  // Germany: comma decimals in the UI, dot in the number input's value
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  const q = await c2.newPage(); q.on('pageerror', e => errs.push(e.message));
  await q.addInitScript(s => localStorage.setItem('calibr.v2', JSON.stringify(s)), { v: 2, settings: { onboarded: true, locate: false, currency: 'EUR' }, categories: [{ id: 'g', emoji: '🛒', name: 'Lebensmittel', limit: 300 }] });
  await q.goto(BASE); await q.waitForSelector('.hero');
  await q.click('#fab'); await q.waitForSelector('#sheet[open] [name=amount]'); await q.fill('[name=amount]', '12.5');
  await q.locator('#capture .chipbtn', { hasText: 'Lebensmittel' }).first().click().catch(() => {});
  await q.click('.actions button[value=save]'); await q.waitForSelector('#sheet:not([open])', { state: 'attached' });
  const txt = await q.locator('.hero').innerText();
  assert(/12,50/.test(txt) && /€/.test(txt), 'euro with a decimal comma: ' + txt);
  const stored = await q.evaluate(() => JSON.parse(localStorage.getItem('calibr.v2')).transactions[0].amount);
  assert.strictEqual(stored, 12.5);
  console.log('  ✓ euro in a German locale: 12,50 € shown, 12.5 stored');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('CURRENCY OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
