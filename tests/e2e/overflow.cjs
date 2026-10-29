const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8124/';
const SP = process.env.OUT || require('os').tmpdir();
const FIX = require('path').join(__dirname, '../fixtures/packs');
const pad = n => String(n).padStart(2, '0');
const mk = off => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const state = { v: 2, settings: { onboarded: true, locate: false, incomeMode: 'varies', income: 2000 },
  categories: [{ id: 'h', emoji: '🏠', name: 'Housing and utilities with a very long name here', limit: 1900, essential: true }, { id: 'g', emoji: '🛒', name: 'Groceries', limit: 400, essential: true }, { id: 'e', emoji: '🍽️', name: 'Eating out', limit: 200 }],
  overrides: { [mk(0)]: { e: 100 } }, recurring: [{ id: 'r', type: 'expense', amount: 1200.5, cat: 'h', note: 'Rent and a long description of the thing', freq: 'monthly', next: today, anchor: 1 }],
  transactions: [...[3000, 2000, 4000, 1800, 3500, 2500].map((a, i) => ({ id: 'i' + i, type: 'income', amount: a, date: mk(i - 6) + '-10', note: 'pay' })),
    { id: 'n1', type: 'income', amount: 850, date: today, note: 'Week 1' }, { id: 'x1', type: 'expense', amount: 12345.67, cat: 'g', date: today, note: 'A very long merchant name like Walmart Neighborhood Market and Pharmacy' },
    { id: 'rv', type: 'expense', amount: 33.1, cat: null, date: today, note: '', status: 'review', sugg: ['g', 'e'], near: ['A very long place name number one', 'Another very long place name'] }],
  goals: [{ id: 'b', emoji: '🛟', name: 'Income buffer with a long name', target: 60000, saved: 12500, buffer: true }] };
(async () => {
  const b = await chromium.launch();
  const bad = [];
  for (const w of [320, 360]) {
    const c = await b.newContext({ viewport: { width: w, height: 640 }, locale: 'en-US' });
    const p = await c.newPage();
    await p.addInitScript(() => addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'body{font-size:17px} body,button,input,select{font-family:"DejaVu Sans Mono","Liberation Mono",monospace !important}'; document.head.append(st); })); // wider text than usual: real phones vary const oc = p.click.bind(p); p.click = (sel, o) => { process.stdout.write('click ' + sel + '\n'); return oc(sel, { timeout: 5000, ...(o||{}) }); };
    await p.addInitScript(s => localStorage.setItem('calibr.v2', JSON.stringify(s)), state);
    await p.goto(BASE); await p.waitForSelector('.hero');
    const check = async name => { await p.waitForTimeout(250); const r = await p.evaluate(() => { const d = document.getElementById('sheet'); const root = d.open ? d : document.documentElement; return { page: document.documentElement.scrollWidth - innerWidth, sheet: d.open ? d.scrollWidth - d.clientWidth : 0 }; }); if (r.page > 1 || r.sheet > 1) bad.push(`${w}px ${name}: page +${r.page}, sheet +${r.sheet}`); };
    for (const tab of ['budget', 'activity', 'insights', 'goals', 'settings']) { await p.click(`[data-tab=${tab}]`); await check(tab); }
    await p.click('[data-tab=budget]');
    const sheets = [['add', '#fab'], ['review', '.banner'], ['lean', '[data-act=lean]'], ['cat detail', '[data-act=cat] >> nth=0']];
    for (const [n, sel] of sheets) { try { await p.click(sel, { timeout: 4000 }); await check(n); } catch (e) { bad.push(`${w}px ${n}: CLICK FAILED ${sel}: ` + e.message.split('\n').slice(0, 4).join(' ').slice(0, 250)); } await p.keyboard.press('Escape'); await p.waitForTimeout(100); }
    await p.click('[data-act=cat] >> nth=0'); await p.click('[data-act=editcat]'); await check('edit category'); await p.keyboard.press('Escape');
    await p.click('[data-tab=goals]'); await p.click('[data-act=fund]'); await check('fund goal'); await p.keyboard.press('Escape');
    await p.click('[data-tab=settings]'); await p.click('[data-act=addrec]'); await check('recurring'); await p.keyboard.press('Escape');
    await p.click('[data-act=diag]'); await check('diag'); await p.keyboard.press('Escape');
    await p.click('[data-tab=activity]'); await p.locator('#txlist li:has-text("Walmart")').click(); await check('edit tx'); await p.click('[data-act=split]'); await check('split');
  }
  await b.close();
  console.log(bad.length ? 'OVERFLOW:\n' + bad.join('\n') : 'no horizontal overflow at 320/360px');
  if (bad.length) process.exit(1);
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
