const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, locate: false }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }, { id: 'e', emoji: '🍽️', name: 'Eating out', limit: 100 }] })));
  await p.goto(BASE); await p.waitForSelector('.hero');
  const active = () => p.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, name: a.name || '', cls: a.className || '', inSheet: !!a.closest('#sheet'), behind: !!a.closest('#view, #nav, #top, #fab'), label: a.getAttribute('aria-label') || '' }; });

  // sheets are named, and start on a real field rather than the close button
  await p.click('[data-act=cat] >> nth=0'); await p.click('[data-act=editcat]'); await p.waitForSelector('#sheet[open] [name=name]');
  const a1 = await active();
  assert(a1.inSheet && !/sheetx/.test(a1.cls) && ['INPUT', 'SELECT'].includes(a1.tag), 'focus starts on a field: ' + JSON.stringify(a1));
  const labelled = await p.evaluate(() => { const d = document.getElementById('sheet'); const id = d.getAttribute('aria-labelledby'); return document.getElementById(id)?.innerText; });
  assert(/Edit category/.test(labelled), 'dialog is named: ' + labelled);
  console.log('  ✓ category sheet is named "' + labelled + '" and focus starts on:', a1.tag, a1.name);

  // Tab never leaves the sheet
  for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); if ((await active()).behind) assert.fail('focus reached the page behind the sheet on tab ' + i); }
  for (let i = 0; i < 10; i++) { await p.keyboard.press('Shift+Tab'); if ((await active()).behind) assert.fail('focus reached the page behind on shift-tab'); }
  console.log('  ✓ focus never reaches the page behind an open sheet (40 tabs forward, 10 back)');
  await p.keyboard.press('Escape'); await p.waitForSelector('#sheet:not([open])', { state: 'attached' });

  // keyboard-only add: Tab to the + button, Enter, type, Enter
  await p.focus('#fab'); await p.keyboard.press('Enter'); await p.waitForSelector('#sheet[open] [name=amount]');
  assert.strictEqual((await active()).name, 'amount', 'amount is focused');
  await p.keyboard.type('12.5'); await p.keyboard.press('Enter');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('calibr.v2')).transactions.length);
  assert.strictEqual(stored, 1);
  console.log('  ✓ keyboard only: focus the + button, Enter, type the amount, Enter saves');

  // landmarks and live regions
  const sem = await p.evaluate(() => ({ nav: !!document.querySelector('nav[aria-label]'), main: !!document.querySelector('main'), live: document.getElementById('toast').getAttribute('aria-live'), role: document.getElementById('toast').getAttribute('role'), current: document.querySelectorAll('#nav [aria-current=page]').length, lang: document.documentElement.lang }));
  assert(sem.nav && sem.main && sem.live === 'polite' && sem.role === 'status' && sem.current === 1 && sem.lang === 'en', JSON.stringify(sem));
  console.log('  ✓ landmarks, polite live region for toasts, current tab announced');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('KEYBOARD OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
