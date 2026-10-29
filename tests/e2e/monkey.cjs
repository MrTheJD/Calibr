// A seeded "monkey": taps and types at random across the app and fails on any uncaught error or layout break.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8124/';
const SEEDS = (process.env.MONKEY_SEEDS || '1,2,3').split(',').map(Number), STEPS = +(process.env.MONKEY_STEPS || 140);
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pad = n => String(n).padStart(2, '0');
const mk = off => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const state = { v: 2, settings: { onboarded: true, locate: false, incomeMode: 'varies', income: 2000 },
  categories: [{ id: 'h', emoji: '🏠', name: 'Housing', limit: 900, essential: true }, { id: 'g', emoji: '🛒', name: 'Groceries', limit: 400, essential: true }, { id: 'e', emoji: '🍽️', name: 'Eating out', limit: 200 }],
  recurring: [{ id: 'r', type: 'expense', amount: 60, cat: 'e', note: 'Phone', freq: 'monthly', next: today, anchor: 1 }],
  transactions: [...[3000, 2000, 4000, 1800].map((a, i) => ({ id: 'i' + i, type: 'income', amount: a, date: mk(i - 5) + '-10', note: 'pay' })), { id: 'n1', type: 'income', amount: 850, date: today, note: 'Week 1' }, { id: 'x1', type: 'expense', amount: 120, cat: 'g', date: today, note: 'Harps' },
    { id: 'rv', type: 'expense', amount: 33.1, cat: null, date: today, status: 'review', sugg: ['g', 'e'], note: '' }], goals: [{ id: 'b', emoji: '🛟', name: 'Income buffer', target: 6000, saved: 1250, buffer: true }] };
const JUNK = ['', '0', '-5', '1e9', '99999999999', '12.345', 'abc', '   ', '0.001', '<b>x</b>', '😀', '2'.repeat(30), '7'];
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const seed of SEEDS) {
    const r = rng(seed * 7919), pick = a => a[Math.floor(r() * a.length)];
    const c = await b.newContext({ viewport: { width: 360, height: 740 }, locale: 'en-US', geolocation: { latitude: 40.75029, longitude: -74.0014, accuracy: 15 }, permissions: ['geolocation'] });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('dialog', d => (r() > 0.3 ? d.accept() : d.dismiss()));
    await p.addInitScript(s => localStorage.getItem('calibr.v2') || localStorage.setItem('calibr.v2', JSON.stringify(s)), state);
    await p.goto(BASE); await p.waitForSelector('#view');
    const log = [];
    for (let i = 0; i < STEPS && !errs.length; i++) {
      const roll = r();
      try {
        if (roll < 0.12) { await p.keyboard.press('Escape'); log.push('esc'); }
        else if (roll < 0.40) { // type junk into a visible input
          const inputs = p.locator('dialog[open] input:not([type=radio]):not([type=checkbox]):not([hidden]):not(.vh), #view input:not([type=checkbox]):not([hidden])');
          const n = await inputs.count(); if (n) { const el = inputs.nth(Math.floor(r() * n)); const ty = await el.getAttribute('type'); const v = ty === 'date' ? pick(['2026-02-29', '2026-10-01', '1999-01-01', '2030-12-31', '']) : pick(JUNK); await el.fill(v, { timeout: 800 }).catch(() => {}); log.push(`fill ${v}`); }
        } else { // click something clickable
          const els = p.locator('dialog[open] button:visible, dialog[open] label:visible, #nav button, #top button, #fab:visible, #view [data-act]:visible, #view select:visible');
          const n = await els.count(); if (n) { const el = els.nth(Math.floor(r() * n)); const tag = await el.evaluate(e => e.tagName); if (tag === 'SELECT') { const opts = await el.locator('option').count(); await el.selectOption({ index: Math.floor(r() * opts) }, { timeout: 800 }).catch(() => {}); log.push('select'); } else { const label = (await el.innerText().catch(() => '')).slice(0, 20).replace(/\n/g, ' '); await el.click({ timeout: 800, force: r() > 0.9 }).catch(() => {}); log.push('click ' + label); } }
        }
      } catch (e) { errs.push('driver: ' + e.message.split('\n')[0]); }
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth).catch(() => 0);
      if (over > 1) {
        const who = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(e => `${e.tagName.toLowerCase()}.${e.className} "${(e.innerText || '').slice(0, 40).replace(/\n/g, ' ')}"`));
        const more = await p.evaluate(() => ({ html: document.documentElement.scrollWidth, body: document.body.scrollWidth, iw: innerWidth, dialogOpen: document.getElementById('sheet').open, tab: document.querySelector('#nav .on')?.innerText, wide: [...document.querySelectorAll("*")].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "visible").slice(0, 6).map(e => e.tagName + "." + e.className + " sw=" + e.scrollWidth + " cw=" + e.clientWidth + " txt=" + (e.innerText || "").slice(0, 90).replace(/\n/g, " | ")), vh: [...document.querySelectorAll('.vh')].slice(0, 2).map(e => JSON.stringify(e.getBoundingClientRect())) }));
        errs.push(`layout: page overflows by ${over}px ${JSON.stringify(more)}`);
      }
      const stuck = await p.evaluate(() => !document.getElementById('view').innerHTML.trim()).catch(() => false);
      if (stuck) errs.push('layout: the main view went blank');
    }
    const ok = !errs.length; if (!ok) bad++;
    console.log(`${ok ? '  ✓' : '  ✗'} monkey seed ${seed}: ${STEPS} random actions${ok ? '' : ' | ' + errs[0] + '\n    last actions: ' + log.slice(-8).join(' > ')}`);
    await c.close();
  }
  await b.close(); if (bad) { console.error('FAIL monkey found problems'); process.exit(1); } console.log('MONKEY OK');
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
