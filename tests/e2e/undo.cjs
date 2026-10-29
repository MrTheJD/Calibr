const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const mk = async (settings, extra = {}) => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' }); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.addInitScript(([s, x]) => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, locate: false, ...s }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }], ...x })), [settings, extra]);
    await p.goto(BASE); await p.waitForSelector('#view'); return p; };
  const count = p => p.evaluate(() => JSON.parse(localStorage.getItem('calibr.v2')).transactions.length);
  const add = async (p, amt) => { await p.click('#fab'); await p.waitForSelector('#sheet[open] [name=amount]'); await p.fill('[name=amount]', String(amt)); await p.click('.actions button[value=save]'); await p.waitForSelector('#sheet:not([open])', { state: 'attached' }); };

  // 1) Undo works when nothing else changed
  let p = await mk({ seenVersion: '1.4.0' });
  await add(p, 12); assert.strictEqual(await count(p), 1);
  await p.click('#toast [data-act=undo]');
  assert.strictEqual(await count(p), 0, 'undo removed the purchase');
  console.log('  ✓ undo removes the purchase when nothing else changed');

  // 2) ...but refuses to clobber something changed in the meantime
  await add(p, 9); assert.strictEqual(await count(p), 1);
  await p.click('[data-tab=settings]'); await p.check('#s-quick');   // another change while the Undo toast is still up
  await p.click('#toast [data-act=undo]');
  assert((await p.locator('#toast').innerText()).includes("Can't undo"), await p.locator('#toast').innerText());
  assert.strictEqual(await count(p), 1, 'the purchase is still there');
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('calibr.v2')).settings.quickOpen), true, 'and so is the setting');
  console.log('  ✓ undo refuses to silently revert a later change');
  assert.deepStrictEqual(p.errs, []);

  // 3) the "what's new" card: shown once to an existing user, stays dismissed, never shown to a new user
  p = await mk({});
  const card = p.locator('.card:has-text("What\'s new in Calibr")');
  assert.strictEqual(await card.count(), 1, 'existing user sees what is new');
  assert((await card.innerText()).includes('location'), await card.innerText());
  await card.locator('[data-act=dismissnews]').click();
  assert.strictEqual(await p.locator('.card:has-text("What\'s new in Calibr")').count(), 0);
  await p.reload(); await p.waitForSelector('#view');
  assert.strictEqual(await p.locator('.card:has-text("What\'s new in Calibr")').count(), 0, 'stays dismissed');
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' }); const q = await c2.newPage();
  await q.goto(BASE); await q.waitForSelector('#sheet[open]'); await q.click('.actions button[value=go]'); await q.waitForSelector('.hero');
  assert.strictEqual(await q.locator('.card:has-text("What\'s new in Calibr")').count(), 0, 'a brand-new user has nothing to catch up on');
  console.log('  ✓ "what\'s new" shows once to existing users, never to new ones');
  await b.close(); console.log('UNDO OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
