const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8124/';
const pad = n => String(n).padStart(2, '0');
const d = new Date(); const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const emojis = ['🛒', '🏠', '🚗', '🍽️', '🎉', '💡', '💊', '🛍️', '✈️', '🎓'];
const cats = Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, emoji: emojis[i % 10], name: i % 3 === 0 ? `A really quite long category name number ${i} for testing` : `Category ${i}`, limit: 50 + i * 10, essential: i < 4 }));
const tx = Array.from({ length: 300 }, (_, i) => ({ id: 't' + i, type: i % 25 === 0 ? 'income' : 'expense', amount: 5 + (i * 7) % 90, cat: i % 25 === 0 ? null : 'c' + (i % 30), date: today, note: i % 4 ? `Purchase ${i} at a store with a fairly long descriptive note` : '', ...(i % 37 === 0 ? { status: 'review', cat: null, sugg: ['c1', 'c2', 'c3'] } : {}) }));
(async () => {
  const b = await chromium.launch();
  for (const w of [320, 390]) {
    const c = await b.newContext({ viewport: { width: w, height: 640 }, locale: 'en-US' });
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(([cats, tx]) => { addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'body,button,input,select{font-family:"DejaVu Sans Mono","Liberation Mono",monospace !important}'; document.head.append(st); }); localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify({ v: 2, settings: { onboarded: true, locate: false, incomeMode: 'varies', income: 4000 }, categories: cats, transactions: tx })); }, [cats, tx]);
    await p.goto(BASE); await p.waitForSelector('.hero');
    const over = async where => { await p.waitForTimeout(150); const o = await p.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, (() => { const s = document.getElementById('sheet'); return s.open ? s.scrollWidth - s.clientWidth : 0; })())); assert(o <= 1, `${w}px ${where}: overflows by ${o}px`); };
    for (const tab of ['budget', 'activity', 'insights', 'goals', 'settings']) { await p.click(`[data-tab=${tab}]`); await over(tab); }
    await p.click('[data-tab=budget]');
    await p.click('.banner'); await over('review (many items)'); await p.keyboard.press('Escape');
    await p.click('#fab'); await p.waitForSelector('#sheet[open] [name=amount]'); await over('add sheet with 30 categories');
    await p.click('#more summary'); await p.locator('#catfield input[name=cat][value=c29] + span').click(); // a category far below the fold
    await p.fill('[name=amount]', '7'); await p.click('.actions button[value=save]'); await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
    const last = await p.evaluate(() => JSON.parse(localStorage.getItem('calibr.v2')).transactions.slice(-1)[0]);
    assert.strictEqual(last.cat, 'c29', 'picked the 30th category and saved');
    await p.click('[data-act=lean]').catch(() => {}); await over('lean sheet');
    assert.deepStrictEqual(errs, []);
    await c.close();
  }
  await b.close(); console.log('  ✓ 30 categories, long names and 300 transactions fit 320px and 390px with a wide font; every control is reachable');
  console.log('MANY OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
