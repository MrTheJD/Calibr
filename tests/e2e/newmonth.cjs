const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Chicago' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-31T23:50:00-05:00') });
  await p.addInitScript(() => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, locate: false }, categories: [{ id: 'g', emoji: '🛒', name: 'Groceries', limit: 400 }],
    recurring: [{ id: 'r', type: 'expense', amount: 15, cat: 'g', note: 'Streaming', freq: 'monthly', next: '2026-11-01', anchor: 1 }] })));
  await p.goto(BASE); await p.waitForSelector('.hero');
  assert((await p.locator('#month').innerText()).includes('October 2026'));
  // the phone sleeps; the user returns after midnight
  await p.clock.setSystemTime(new Date('2026-11-01T07:30:00-05:00'));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForFunction(() => document.getElementById('month').innerText.includes('November 2026'));
  assert((await p.locator('[data-act=cat]:has(.title:text-is("Groceries"))').innerText()).includes('$15.00 of'), 'the recurring item due on the 1st was added');
  console.log('  ✓ returning after midnight on the 1st moves to the new month and adds what came due');
  // a user who deliberately looked at an older month is not yanked away
  await p.click('[data-act=prev]'); await p.click('[data-act=prev]');
  const before = await p.locator('#month').innerText();
  await p.clock.setSystemTime(new Date('2026-12-01T07:30:00-06:00'));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(300);
  assert.strictEqual(await p.locator('#month').innerText(), before, 'older month left alone');
  console.log('  ✓ someone browsing an older month stays where they are');
  assert.deepStrictEqual(errs, []);
  await b.close(); console.log('NEWMONTH OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
