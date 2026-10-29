const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
const pad = n => String(n).padStart(2, '0');
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  // Spend only today and exactly one week ago, so the comparison is the same stretch of days whatever today is.
  await p.addInitScript(([a, b2]) => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, locate: false }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }],
    transactions: [{ id: 'a', type: 'expense', amount: 40, cat: 'g', date: a, note: 'now' }, { id: 'b', type: 'expense', amount: 25, cat: 'g', date: b2, note: 'then' }] })), [ago(0), ago(7)]);
  await p.goto(BASE); await p.waitForSelector('.hero'); await p.click('[data-tab=insights]');
  const card = await p.locator('.card:has-text("spent so far")').innerText();
  assert(card.includes('$40.00') && card.includes('$15.00 vs same days last week') && card.includes('Groceries'), card);
  console.log('  ✓ this week vs the same days last week:', card.replace(/\n/g, ' | '));
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('WEEK OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
