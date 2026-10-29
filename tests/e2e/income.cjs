const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8124/';
const SP = process.env.OUT || require('os').tmpdir();
const FIX = require('path').join(__dirname, '../fixtures/packs');
const assert = require('assert');
const URL = BASE;
const pad = n => String(n).padStart(2, '0');
const monthKey = off => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const cats = [
  { id: 'h', emoji: '🏠', name: 'Housing', limit: 900, essential: true }, { id: 'g', emoji: '🛒', name: 'Groceries', limit: 400, essential: true },
  { id: 'e', emoji: '🍽️', name: 'Eating out', limit: 200 }, { id: 'f', emoji: '🎉', name: 'Fun', limit: 200 },
];
const hist = [3000, 2000, 4000, 1800, 3500, 2500]; // 6 completed months, oldest first
const seed = (extra = {}) => ({ v: 2, settings: { onboarded: true, locate: false, incomeMode: 'varies', currency: 'USD', ...(extra.settings || {}) }, categories: cats,
  transactions: [...hist.map((a, i) => ({ id: 'i' + i, type: 'income', amount: a, date: monthKey(i - 6) + '-10', note: 'pay' })), ...(extra.tx || [])], goals: extra.goals || [], recurring: extra.recurring || [] });
(async () => {
  const b = await chromium.launch();
  const step = n => console.log('  ✓', n);
  const mk = async (state) => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' }); const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.addInitScript(([s]) => { if (!localStorage.getItem('calibr.v2')) localStorage.setItem('calibr.v2', JSON.stringify(s)); }, [state]); await p.goto(URL); await p.waitForSelector('.hero'); p.errs = errs; return p; };
  const text = (p, sel) => p.locator(sel).first().innerText();

  // ---- scenario 1: lean month then a windfall
  const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  let p = await mk(seed({ tx: [{ id: 'now', type: 'income', amount: 1200, date: today, note: 'week 1' }], recurring: [
    { id: 'r1', type: 'expense', amount: 900, cat: 'h', note: 'Rent', freq: 'monthly', next: inDays(3), anchor: 1 }, { id: 'r2', type: 'expense', amount: 60.5, cat: 'e', note: 'Phone', freq: 'monthly', next: inDays(5), anchor: 1 },
    { id: 'r3', type: 'income', amount: 700, cat: null, note: 'Gig payout', freq: 'weekly', next: inDays(2), anchor: 1 }] }));
  assert((await text(p, 'h2:has-text("Coming up")')).toLowerCase().includes('$960.50 due · $700.00 expected'), await text(p, 'h2:has-text("Coming up")'));
  let hero = await text(p, '.hero');
  assert(hero.includes('Plan $2,100.00') && hero.includes('received $1,200.00'), hero);
  assert(hero.includes('$900.00 to go to reach your plan'), hero);
  assert(hero.includes('Essentials $1,300.00') && hero.includes('$100.00 still to cover'), hero);
  const rowsTxt = await text(p, '#view');
  assert(/Groceries[\s\S]*\$100\.00 not funded yet/.test(rowsTxt), 'partially funded essential: ' + rowsTxt.slice(0, 900));
  assert(/Eating out[\s\S]*not funded yet/.test(rowsTxt) && !/Housing[\s\S]{0,60}not funded yet/.test(rowsTxt.split('Groceries')[0]), 'flexible categories wait; housing is funded');
  step('plans on the average of the lower half of recent months ($2,100), shows received so far, and which categories are funded');

  await p.click('[data-act=lean]');
  await p.waitForSelector('#leanout');
  await p.fill('[name=avail]', '1500');
  const lean = await text(p, '#leanout');
  assert(lean.includes('$1,300.00') && lean.includes('Essentials'), lean); // essentials 900+400
  assert(/Eating out[\s\S]*\$200\.00 →\s*\$100\.00/.test(lean) || lean.includes('$100.00'), lean);
  await p.waitForTimeout(300); await p.screenshot({ path: `${SP}/30-lean.png` });
  await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  const row = await text(p, '[data-act=cat]:has-text("Eating out")');
  assert(row.includes('adjusted') && row.includes('$100.00'), row);
  assert((await text(p, '[data-act=cat]:has-text("Housing")')).includes('$900.00'), 'essentials untouched');
  step('lean month: essentials protected, flexible categories trimmed to fit $1,500');

  // next month unaffected
  await p.click('[data-act=next]');
  assert(!(await text(p, '[data-act=cat]:has-text("Eating out")')).includes('adjusted'));
  await p.click('[data-act=prev]');

  // per-category month limit + reset
  await p.click('[data-act=cat]:has(.title:text-is("Fun"))');
  await p.click('[data-act=monthlimit]');
  await p.fill('[name=limit]', '50');
  await p.click('.actions button[value=save]');
  { const ft = await text(p, '[data-act=cat]:has(.title:text-is("Fun"))'); assert(ft.includes('of $50.00'), 'fun row: ' + ft + ' | overrides: ' + await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('calibr.v2')).overrides)) + ' | sheet open: ' + await p.evaluate(() => document.getElementById('sheet').open)); }
  await p.click('[data-act=lean]');
  await p.click('.actions button[value=reset]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert(!(await text(p, '#view')).includes('adjusted'), 'reset clears all adjustments');
  step('per-month limit change for one category; reset clears them');

  // windfall: income above plan -> buffer
  await p.click('#fab');
  await p.locator('label:has-text("Income") span').first().click();
  await p.fill('[name=amount]', '1500');
  await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert((await text(p, '#toast')).includes('$600.00 above your plan'), await text(p, '#toast'));
  hero = await text(p, '.hero');
  assert(hero.includes('$600.00 above your plan') && hero.includes('✓ covered'), hero);
  await p.click('[data-act=tobuffer]');
  await p.waitForSelector('#sheet[open] [name=amount]');
  await p.fill('[name=amount]', '500');
  await p.click('.actions button[value=save]');
  await p.waitForSelector('#sheet:not([open])', { state: 'attached' });
  assert((await text(p, '.hero')).includes('$100.00 above your plan'), 'only the remainder is still surplus');
  await p.click('[data-tab=goals]');
  const goals = await text(p, '#view');
  assert(goals.includes('Income buffer') && goals.includes('$500.00 of'), goals);
  assert(goals.includes('months of your plan'), goals);
  step('windfall: toast shows the surplus, $500 moved to an Income buffer goal, remainder still shown');

  // plan unaffected by the current month; stats
  await p.click('[data-tab=insights]');
  const ins = await text(p, '#view');
  assert(ins.toLowerCase().includes('your income') && ins.includes('$1,800.00 – $4,000.00'), ins.slice(0, 600));
  step('insights show how much pay varies');

  // settings: override + clear
  await p.click('[data-tab=settings]');
  assert((await text(p, '#view')).includes('Auto: $2,100.00'));
  await p.fill('#s-plan', '1800'); await p.press('#s-plan', 'Tab');
  await p.click('[data-tab=budget]');
  assert((await text(p, '.hero')).includes('Plan $1,800.00'));
  await p.click('[data-tab=settings]');
  await p.fill('#s-plan', ''); await p.press('#s-plan', 'Tab');
  await p.click('[data-tab=budget]');
  assert((await text(p, '.hero')).includes('Plan $2,100.00'));
  step('manual plan override and back to auto');
  assert.deepStrictEqual(p.errs, []);

  // ---- scenario 2: short month, buffer covers the gap, and does not count as earnings
  p = await mk(seed({ tx: [{ id: 'now', type: 'income', amount: 800, date: today, note: 'slow week' }], goals: [{ id: 'b', emoji: '🛟', name: 'Income buffer', target: 6000, saved: 500, buffer: true }] }));
  assert((await text(p, '.hero')).includes('$1,300.00 to go'));
  await p.click('[data-act=usebuffer]');
  hero = await text(p, '.hero');
  assert(hero.includes('received $800.00 + $500.00 buffer') && hero.includes('$800.00 to go'), 'buffer draw does not count as earnings: ' + hero);
  await p.click('[data-tab=goals]');
  assert((await text(p, '#view')).includes('$0.00 of'), 'buffer drained');
  await p.click('[data-tab=activity]');
  assert((await text(p, '#txlist')).includes('From buffer'));
  step('buffer covers a shortfall without inflating the plan');
  assert.deepStrictEqual(p.errs, []);

  // ---- scenario 3: steady user with a wide spread is offered the switch
  p = await mk(seed({ settings: { incomeMode: 'steady', income: 3000 } }));
  assert((await text(p, '.hero')).includes('Income $3,000.00'));
  await p.click('[data-tab=insights]');
  assert((await text(p, '#view')).includes('Plan around my lower months'));
  await p.click('[data-act=setvaries]');
  await p.click('[data-tab=budget]');
  assert((await text(p, '.hero')).includes('Plan $2,100.00'));
  step('steady user with fluctuating history is offered variable-income planning');

  // ---- onboarding asks
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const q = await c.newPage(); await q.goto(URL); await q.waitForSelector('#sheet[open]');
  await q.locator('label:has-text("Different each time") span').click();
  await q.fill('[name=income]', '2000');
  await q.click('.actions button[value=go]');
  await q.waitForSelector('.hero');
  assert((await text(q, '.hero')).includes('Plan $2,000.00'), await text(q, '.hero'));
  step('onboarding: "different each time" starts variable planning from a low-month estimate');
  await b.close();
  console.log('E2E4 OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
