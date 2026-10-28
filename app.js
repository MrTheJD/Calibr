import * as L from './logic.js';

const KEY = 'calibr.v2', OLD = 'calibr.v1', VERSION = '1.1.0';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const EMOJI = ['🛒', '🏠', '🚗', '🍽️', '🎉', '💡', '💊', '🛍️', '✈️', '🎓', '👶', '🐶', '🎁', '📱', '💪', '☕', '🎮', '📚', '🧾', '💰', '🏦', '🛠️', '🌱', '🎯'];

// ---------- state ----------
function load() {
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) { const s = L.sanitize(JSON.parse(cur)); if (s) return s; }
    const old = localStorage.getItem(OLD);
    if (old) { const s = L.migrate(JSON.parse(old)); if (s) return s; }
  } catch (e) {
    try { localStorage.setItem('calibr.corrupt', localStorage.getItem(KEY) || ''); } catch {}
  }
  const s = L.defaultState();
  const region = (navigator.language || '').split('-')[1];
  const guess = { GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', IN: 'INR', MX: 'MXN', BR: 'BRL', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', ZA: 'ZAR', SG: 'SGD', HK: 'HKD', KR: 'KRW', CN: 'CNY', PH: 'PHP', AE: 'AED',
    DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR' }[region];
  if (guess) s.settings.currency = guess;
  return s;
}
let S = load();
let saveFailed = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); saveFailed = false; }
  catch { if (!saveFailed) toast("Couldn't save — storage is full or blocked"); saveFailed = true; }
}

const ui = { tab: 'budget', month: L.monthOf(L.todayStr()), q: '', type: 'all', cat: 'all' };

const nfCache = {};
const money = n => (nfCache[S.settings.currency] ??= new Intl.NumberFormat(undefined, { style: 'currency', currency: S.settings.currency })).format(n);
const monthLabel = (key, opts = { month: 'long', year: 'numeric' }) => new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, 1).toLocaleDateString(undefined, opts);
const parseDate = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const prettyDate = s => {
  const t = L.todayStr();
  if (s === t) return 'Today';
  if (s === L.addDays(t, -1)) return 'Yesterday';
  if (s === L.addDays(t, 1)) return 'Tomorrow';
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const catOf = id => S.categories.find(c => c.id === id);
const level = pct => (pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '');
const bar = (pct, cls = '') => `<div class="bar ${cls.includes('thin') ? 'thin' : ''}"><i class="${cls.replace('thin', '').trim() || level(pct)}" style="width:${Math.max(0, Math.min(pct, 100))}%"></i></div>`;
const firstGlyph = s => {
  s = (s || '').trim();
  if (!s) return '';
  try { return [...new Intl.Segmenter().segment(s)][0].segment; } catch { return Array.from(s)[0]; }
};

// ---------- toast + undo ----------
let toastTimer;
function toast(msg, undo) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}`;
  t.hidden = false;
  toast.undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 6000 : 3000);
}
// Run a change and offer to put things back.
function change(msg, fn) {
  const before = JSON.stringify(S);
  fn();
  save();
  render();
  toast(msg, () => { S = L.sanitize(JSON.parse(before)); save(); render(); });
}

// ---------- sheets ----------
const sheet = $('sheet');
function openSheet(html, onSubmit, onMount, primary = 'save') {
  // Hidden first submit button: pressing Enter submits the primary action, not whichever button comes first.
  sheet.innerHTML = `<form method="dialog"><button class="vh" value="${primary}" tabindex="-1" aria-hidden="true"></button>${html}</form>`;
  const form = sheet.firstElementChild;
  form.onsubmit = ev => {
    const v = ev.submitter?.value;
    if (!v || v === 'cancel') return;
    if (onSubmit(v, new FormData(form), form) === false) ev.preventDefault();
  };
  if (!sheet.open) sheet.showModal();
  onMount?.(form);
  return form;
}
sheet.addEventListener('click', ev => { if (ev.target === sheet) sheet.close(); });
const closeSheet = () => sheet.open && sheet.close();

const emojiPicker = () => `<div class="emojis" role="group" aria-label="Pick an icon">${EMOJI.map(e => `<button type="button" data-act="emoji" data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`;

const catChips = (selected, name = 'cat') => `<div class="chips" role="radiogroup" aria-label="Category">${S.categories.map(c =>
  `<label><input class="vh" type="radio" name="${name}" value="${c.id}" ${c.id === selected ? 'checked' : ''}><span>${c.emoji} ${esc(c.name)}</span></label>`).join('')}
  <label><input class="vh" type="radio" name="${name}" value="" ${!selected || !catOf(selected) ? 'checked' : ''}><span>❔ None</span></label></div>`;

const typeSeg = type => `<div class="seg" role="radiogroup" aria-label="Type">
  <label><input class="vh" type="radio" name="type" value="expense" ${type !== 'income' ? 'checked' : ''}><span>Expense</span></label>
  <label><input class="vh" type="radio" name="type" value="income" ${type === 'income' ? 'checked' : ''}><span>Income</span></label></div>`;

const dateField = (value, name = 'date', label = 'Date') => `<div class="field"><label for="f-${name}">${label}</label>
  <div class="datepick"><input id="f-${name}" type="date" name="${name}" value="${value}" required>
  <button type="button" class="btn" data-act="setdate" data-d="0">Today</button><button type="button" class="btn" data-act="setdate" data-d="-1">Yesterday</button></div></div>`;

// ---- transaction sheet ----
function txSheet(tx, preset = {}) {
  const editing = !!tx;
  const type = tx?.type ?? preset.type ?? 'expense';
  const lastCat = catOf(S.settings.lastCat) ? S.settings.lastCat : S.categories[0]?.id;
  const selCat = tx ? tx.cat : (preset.cat ?? lastCat);
  const date = tx?.date ?? L.todayStr();
  const recent = [...new Set(S.transactions.slice().reverse().map(t => t.note).filter(Boolean))].slice(0, 40);
  openSheet(`
    <h3>${editing ? 'Edit' : 'Add'} transaction</h3>
    <div class="field">${typeSeg(type)}</div>
    <div class="field"><label for="f-amount" class="vh">Amount</label>
      <input id="f-amount" class="amount" name="amount" type="number" inputmode="decimal" step="any" min="0.01" placeholder="0.00" value="${tx ? tx.amount : ''}" required></div>
    <div class="field" id="catfield"><span class="lab">Category</span>${catChips(selCat)}</div>
    <div class="field"><label for="f-note">Note (optional)</label>
      <input id="f-note" name="note" type="text" maxlength="80" list="notes" autocomplete="off" placeholder="What was it for?" value="${esc(tx?.note)}">
      <datalist id="notes">${recent.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
    ${dateField(date)}
    <div class="actions">${editing ? '<button class="btn danger spacer" value="delete" formnovalidate>Delete</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}
      <button class="btn primary" value="save">${editing ? 'Save' : 'Add'}</button></div>`,
  (v, fd) => {
    if (v === 'delete') { change('Transaction deleted', () => { S.transactions = S.transactions.filter(t => t.id !== tx.id); }); return; }
    const amount = L.round2(parseFloat(fd.get('amount')));
    if (!(amount > 0)) return false;
    const t = fd.get('type') === 'income' ? 'income' : 'expense';
    const cat = t === 'expense' ? (fd.get('cat') || null) : null;
    const next = { id: tx?.id ?? L.uid(), type: t, amount, cat, note: String(fd.get('note') || '').trim(), date: fd.get('date'), ...(tx?.rec ? { rec: tx.rec } : {}) };
    change(editing ? 'Transaction updated' : `Added ${money(amount)}${cat ? ' to ' + catOf(cat).name : ''}`, () => {
      if (editing) S.transactions[S.transactions.findIndex(x => x.id === tx.id)] = next; else S.transactions.push(next);
      if (cat) S.settings.lastCat = cat;
    });
    if (next.date.slice(0, 7) !== ui.month && ui.tab !== 'settings' && ui.tab !== 'goals') { ui.month = next.date.slice(0, 7); render(); }
  },
  form => {
    const toggle = () => { $('catfield').hidden = form.elements.type.value === 'income'; };
    form.addEventListener('change', e => { if (e.target.name === 'type') toggle(); });
    toggle();
    let picked = !!tx; // don't override a category the user chose themselves (or an existing one)
    form.addEventListener('change', e => { if (e.target.name === 'cat') picked = true; });
    form.elements.note.addEventListener('input', e => {
      if (picked) return;
      const key = e.target.value.trim().toLowerCase();
      const m = key && S.transactions.slice().reverse().find(t => t.type === 'expense' && t.cat && t.note.toLowerCase() === key);
      if (m) { const r = form.querySelector(`input[name=cat][value="${m.cat}"]`); if (r) r.checked = true; }
    });
    if (!editing) setTimeout(() => form.elements.amount.focus(), 50);
  });
}

// ---- category sheets ----
function catSheet(cat) {
  const editing = !!cat;
  openSheet(`
    <h3>${editing ? 'Edit' : 'New'} category</h3>
    <div class="field"><label for="f-emoji">Icon</label><input id="f-emoji" name="emoji" type="text" value="${esc(cat?.emoji ?? '🏷️')}" style="width:5rem;text-align:center;font-size:1.4rem">${emojiPicker()}</div>
    <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" maxlength="40" required value="${esc(cat?.name)}" placeholder="e.g. Groceries"></div>
    <div class="field"><label for="f-limit">Monthly limit</label><input id="f-limit" name="limit" type="number" inputmode="decimal" step="any" min="0" value="${cat?.limit ?? ''}" placeholder="0" required></div>
    <div class="field"><label class="check"><input type="checkbox" name="rollover" ${cat?.rollover ? 'checked' : ''}><span>Carry unspent money into next month<br><span class="mute small">Starts from this month. Overspending doesn't carry over.</span></span></label></div>
    <div class="actions">${editing ? '<button class="btn danger spacer" value="delete" formnovalidate>Delete</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}
      <button class="btn primary" value="save">Save</button></div>`,
  (v, fd) => {
    if (v === 'delete') {
      change(`${cat.name} deleted`, () => {
        S.categories = S.categories.filter(c => c.id !== cat.id);
        S.transactions.forEach(t => { if (t.cat === cat.id) t.cat = null; });
        S.recurring.forEach(r => { if (r.cat === cat.id) r.cat = null; });
      });
      return;
    }
    const name = String(fd.get('name')).trim();
    if (!name) return false;
    const rollover = fd.get('rollover') === 'on';
    const data = { emoji: firstGlyph(fd.get('emoji')) || '🏷️', name, limit: Math.max(0, L.round2(parseFloat(fd.get('limit')) || 0)), rollover };
    change(editing ? 'Category updated' : 'Category added', () => {
      if (editing) {
        Object.assign(cat, data);
        if (rollover && !cat.since) cat.since = L.monthOf(L.todayStr());
        if (!rollover) cat.since = undefined;
      } else {
        S.categories.push({ id: L.uid(), ...data, since: rollover ? L.monthOf(L.todayStr()) : undefined });
      }
    });
  });
}

function catDetail(id) {
  const B = L.budgetFor(S, ui.month);
  const row = B.cats.find(r => r.cat.id === id);
  if (!row) return;
  const txs = L.monthTx(S, ui.month).filter(t => t.type === 'expense' && t.cat === id).sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`
    <h3>${row.cat.emoji} ${esc(row.cat.name)}</h3>
    <p class="mute" style="margin:0 0 10px">${monthLabel(ui.month)}</p>
    <div class="stats"><div class="stat"><div class="k">Left</div><div class="v ${row.left < 0 ? 'over' : ''}">${money(row.left)}</div></div>
      <div class="stat"><div class="k">Spent of ${money(row.avail)}</div><div class="v">${money(row.spent)}</div></div></div>
    ${row.carry > 0 ? `<p class="small mute">Includes ${money(row.carry)} carried over from earlier months.</p>` : ''}
    ${txs.length ? `<ul class="list">${txs.map(t => `<li><button type="button" class="rowbtn" data-act="tx" data-id="${t.id}"><div class="row"><span class="grow"><div class="title">${esc(t.note || row.cat.name)}</div><div class="small mute">${prettyDate(t.date)}</div></span><span class="amt">${money(t.amount)}</span></div></button></li>`).join('')}</ul>` : '<p class="empty">Nothing spent here yet.</p>'}
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Close</button>
      <button class="btn" type="button" data-act="editcat" data-id="${id}">Edit</button>
      <button class="btn primary" type="button" data-act="addto" data-id="${id}">+ Expense</button></div>`);
}

// ---- goals ----
function goalSheet(goal) {
  const editing = !!goal;
  openSheet(`
    <h3>${editing ? 'Edit' : 'New'} goal</h3>
    <div class="field"><label for="f-emoji">Icon</label><input id="f-emoji" name="emoji" type="text" value="${esc(goal?.emoji ?? '🎯')}" style="width:5rem;text-align:center;font-size:1.4rem">${emojiPicker()}</div>
    <div class="field"><label for="f-name">What are you saving for?</label><input id="f-name" name="name" type="text" maxlength="40" required value="${esc(goal?.name)}" placeholder="e.g. Emergency fund"></div>
    <div class="field"><label for="f-target">Target amount</label><input id="f-target" name="target" type="number" inputmode="decimal" step="any" min="0.01" required value="${goal?.target ?? ''}"></div>
    ${editing ? '' : `<div class="field"><label for="f-saved">Already saved (optional)</label><input id="f-saved" name="saved" type="number" inputmode="decimal" step="any" min="0" value=""></div>`}
    <div class="field"><label for="f-gdate">Target date (optional)</label><input id="f-gdate" name="date" type="date" value="${goal?.date ?? ''}"></div>
    <div class="actions">${editing ? '<button class="btn danger spacer" value="delete" formnovalidate>Delete</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}
      <button class="btn primary" value="save">Save</button></div>`,
  (v, fd) => {
    if (v === 'delete') { change('Goal deleted', () => { S.goals = S.goals.filter(g => g.id !== goal.id); }); return; }
    const name = String(fd.get('name')).trim(), target = L.round2(parseFloat(fd.get('target')));
    if (!name || !(target > 0)) return false;
    const data = { emoji: firstGlyph(fd.get('emoji')) || '🎯', name, target, date: fd.get('date') || '' };
    change(editing ? 'Goal updated' : 'Goal added', () => {
      if (editing) Object.assign(goal, data);
      else S.goals.push({ id: L.uid(), ...data, saved: Math.max(0, L.round2(parseFloat(fd.get('saved')) || 0)) });
    });
  });
}

function fundSheet(goal) {
  openSheet(`
    <h3>${goal.emoji} ${esc(goal.name)}</h3>
    <p class="mute" style="margin:0">${money(goal.saved)} of ${money(goal.target)} saved</p>
    <div class="field"><label for="f-amount" class="vh">Amount</label><input id="f-amount" class="amount" name="amount" type="number" inputmode="decimal" step="any" min="0.01" placeholder="0.00" required></div>
    <div class="actions"><button class="btn" value="withdraw">Withdraw</button><button class="btn primary" value="add">Add</button></div>`,
  (v, fd) => {
    const amt = L.round2(parseFloat(fd.get('amount')));
    if (!(amt > 0)) return false;
    change(v === 'add' ? `Added ${money(amt)} to ${goal.name}` : `Withdrew ${money(amt)}`, () => {
      goal.saved = Math.max(0, L.round2(goal.saved + (v === 'add' ? amt : -amt)));
    });
  }, form => setTimeout(() => form.elements.amount.focus(), 50), 'add');
}

// ---- recurring ----
function recSheet(rec) {
  const editing = !!rec;
  const type = rec?.type ?? 'expense';
  openSheet(`
    <h3>${editing ? 'Edit' : 'New'} recurring ${editing ? '' : 'transaction'}</h3>
    <p class="mute small" style="margin:0">Bills, subscriptions or paychecks that repeat. They're added automatically on their due date.</p>
    <div class="field">${typeSeg(type)}</div>
    <div class="field"><label for="f-note">Name</label><input id="f-note" name="note" type="text" maxlength="80" required value="${esc(rec?.note)}" placeholder="e.g. Rent, Netflix, Paycheck"></div>
    <div class="field"><label for="f-amount">Amount</label><input id="f-amount" name="amount" type="number" inputmode="decimal" step="any" min="0.01" required value="${rec?.amount ?? ''}"></div>
    <div class="field" id="catfield"><span class="lab">Category</span>${catChips(rec?.cat ?? S.categories[0]?.id)}</div>
    <div class="field"><label for="f-freq">Repeats</label><select id="f-freq" name="freq">${Object.entries(L.FREQUENCIES).map(([k, v]) => `<option value="${k}" ${(rec?.freq ?? 'monthly') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${dateField(rec?.next ?? L.todayStr(), 'next', editing ? 'Next due date' : 'First due date')}
    <div class="actions">${editing ? '<button class="btn danger spacer" value="delete" formnovalidate>Delete</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}
      <button class="btn primary" value="save">Save</button></div>`,
  (v, fd) => {
    if (v === 'delete') { change('Recurring item deleted', () => { S.recurring = S.recurring.filter(r => r.id !== rec.id); }); return; }
    const amount = L.round2(parseFloat(fd.get('amount'))), note = String(fd.get('note')).trim();
    if (!(amount > 0) || !note) return false;
    const t = fd.get('type') === 'income' ? 'income' : 'expense';
    const next = fd.get('next');
    const data = { type: t, amount, note, cat: t === 'expense' ? (fd.get('cat') || null) : null, freq: fd.get('freq'), next, anchor: Number(next.slice(8)) };
    change(editing ? 'Recurring item updated' : 'Recurring item added', () => {
      if (editing) Object.assign(rec, data); else S.recurring.push({ id: L.uid(), ...data });
      L.generateRecurring(S, L.todayStr());
    });
  },
  form => {
    const toggle = () => { $('catfield').hidden = form.elements.type.value === 'income'; };
    form.addEventListener('change', e => { if (e.target.name === 'type') toggle(); });
    toggle();
  });
}

// ---- onboarding ----
function onboardSheet() {
  openSheet(`
    <h3>Welcome to Calibr 👋</h3>
    <p class="mute" style="margin:0 0 4px">Set a limit for each kind of spending, log what you spend, and always know what's left. Everything stays on this device.</p>
    <div class="field"><label for="f-income">Monthly income (after tax)</label><input id="f-income" name="income" type="number" inputmode="decimal" step="any" min="0" placeholder="e.g. 3000"></div>
    <div class="field"><label for="f-cur">Currency</label><select id="f-cur" name="currency">${L.CURRENCIES.map(([c, n]) => `<option value="${c}" ${c === S.settings.currency ? 'selected' : ''}>${c} · ${n}</option>`).join('')}</select></div>
    <div class="field"><span class="lab">Starting categories</span>
      <div class="chips" role="radiogroup">
        <label><input class="vh" type="radio" name="tpl" value="essentials" checked><span>Everyday essentials</span></label>
        <label><input class="vh" type="radio" name="tpl" value="503020"><span>50/30/20</span></label>
        <label><input class="vh" type="radio" name="tpl" value="blank"><span>Start blank</span></label></div>
      <p class="mute small" style="margin:8px 0 0">Limits are suggested from your income. You can change everything later.</p></div>
    <div class="actions"><button class="btn" value="skip" formnovalidate>Skip</button><button class="btn primary" value="go">Get started</button></div>`,
  (v, fd) => {
    S.settings.onboarded = true;
    if (v === 'go') {
      const income = Math.max(0, L.round2(parseFloat(fd.get('income')) || 0));
      S.settings.currency = fd.get('currency');
      S.settings.income = income;
      if (!S.categories.length) S.categories = L.template(fd.get('tpl'), income);
    }
    save(); render();
  }, null, 'go');
}
sheet.addEventListener('close', () => { if (!S.settings.onboarded && sheet.querySelector('[name=tpl]')) { S.settings.onboarded = true; save(); render(); } });

// ---------- views ----------
const views = {
  budget() {
    const today = L.todayStr(), cur = ui.month === L.monthOf(today);
    if (!S.categories.length) {
      return `<div class="card empty"><span class="big">🧭</span><b>No categories yet</b><p>Categories are the buckets you budget into, like Groceries or Rent.</p>
        <button class="btn primary" data-act="addcat">Add a category</button> <button class="btn" data-act="onboard">Use a template</button></div>`;
    }
    const B = L.budgetFor(S, ui.month);
    const pct = B.budget ? (B.spent / B.budget) * 100 : B.spent ? 100 : 0;
    let hint = '';
    if (cur) {
      const dl = L.daysLeftInMonth(today);
      hint = B.left > 0 ? `You can spend about <b>${money(B.left / dl)}</b> a day for the next ${plural(dl, 'day')}.`
        : B.left < 0 ? `You're <b class="over">${money(-B.left)}</b> over budget this month.` : 'Budget fully used — nice and exact.';
    }
    const inc = S.settings.income;
    const unassigned = L.round2(inc - B.limits);
    const incomeLine = inc > 0
      ? `<span>Income ${money(inc)}</span><span class="${unassigned < 0 ? 'over' : ''}">${unassigned < 0 ? `Limits exceed income by ${money(-unassigned)}` : `${money(unassigned)} unassigned`}</span>`
      : `<button class="link small" data-act="tab" data-tab="settings">Set your monthly income →</button><span></span>`;
    const upcoming = cur ? L.upcoming(S, today, 14) : [];
    return `<section class="card hero"><div class="label">Left this month</div>
      <div class="big ${B.left < 0 ? 'over' : ''}">${money(B.left)}</div>${bar(pct)}
      <div class="sub"><span>${money(B.spent)} spent</span><span>of ${money(B.budget)}</span></div>
      <div class="sub">${incomeLine}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</section>
      ${upcoming.length ? `<h2>Coming up</h2><ul class="list">${upcoming.map(r => {
        const d = L.daysBetween(today, r.next);
        return `<li><button class="rowbtn" data-act="rec" data-id="${r.id}"><div class="row"><span class="emoji">${r.type === 'income' ? '💵' : catOf(r.cat)?.emoji ?? '🔁'}</span><span class="grow"><div class="title">${esc(r.note)}</div><div class="small mute">${d === 1 ? 'Tomorrow' : `In ${plural(d, 'day')}`}</div></span><span class="amt ${r.type === 'income' ? 'inc' : ''}">${r.type === 'income' ? '+' : ''}${money(r.amount)}</span></div></button></li>`;
      }).join('')}</ul>` : ''}
      <h2>Categories</h2>
      <ul class="list">${B.cats.map(r => `<li><button class="rowbtn" data-act="cat" data-id="${r.cat.id}">
        <div class="row"><span class="emoji">${r.cat.emoji}</span><span class="grow"><div class="title">${esc(r.cat.name)}</div>
        <div class="small mute">${money(r.spent)} of ${money(r.avail)}${r.carry > 0 ? ` · +${money(r.carry)} carried` : ''}</div></span>
        <span class="amt ${r.left < 0 ? 'over' : ''}"><b>${money(Math.abs(r.left))}</b> <span class="mute small">${r.left < 0 ? 'over' : 'left'}</span></span></div>${bar(r.pct, 'thin')}</button></li>`).join('')}
        ${B.uncategorized > 0 ? `<li><div class="rowbtn"><div class="row"><span class="emoji">❔</span><span class="grow"><div class="title">Uncategorized</div><div class="small mute">Not counted toward a category</div></span><span class="amt">${money(B.uncategorized)}</span></div></div></li>` : ''}
      </ul>
      <button class="addrow" data-act="addcat">+ Add category</button>`;
  },

  activity() {
    const txs = L.monthTx(S, ui.month);
    const inc = txs.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    return `<div class="stats" style="margin-top:6px"><div class="stat"><div class="k">Spent</div><div class="v">${money(exp)}</div></div><div class="stat"><div class="k">Income</div><div class="v good">${money(inc)}</div></div></div>
      <div class="filters"><input id="q" type="search" placeholder="Search notes" aria-label="Search" value="${esc(ui.q)}">
      <select id="ftype" aria-label="Type"><option value="all">All types</option><option value="expense" ${ui.type === 'expense' ? 'selected' : ''}>Expenses</option><option value="income" ${ui.type === 'income' ? 'selected' : ''}>Income</option></select>
      <select id="fcat" aria-label="Category"><option value="all">All categories</option>${S.categories.map(c => `<option value="${c.id}" ${ui.cat === c.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}<option value="none" ${ui.cat === 'none' ? 'selected' : ''}>❔ Uncategorized</option></select></div>
      <div id="txlist">${txList()}</div>`;
  },

  insights() {
    const today = L.todayStr(), cur = ui.month === L.monthOf(today);
    const B = L.budgetFor(S, ui.month);
    const days = cur ? Number(today.slice(8)) : L.daysInMonth(ui.month);
    const prev = L.budgetFor(S, L.addMonths(ui.month, -1)).spent;
    const net = L.round2(B.income - B.spent);
    const rows = [...B.cats.map(r => ({ emoji: r.cat.emoji, name: r.cat.name, spent: r.spent })), { emoji: '❔', name: 'Uncategorized', spent: B.uncategorized }]
      .filter(r => r.spent > 0).sort((a, b) => b.spent - a.spent);
    const top = L.monthTx(S, ui.month).filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 3);
    const tr = L.trend(S, ui.month, 6);
    const max = Math.max(1, ...tr.flatMap(t => [t.spent, t.income]));
    if (!rows.length && !B.income) return `<div class="card empty"><span class="big">📊</span><b>Nothing to analyze yet</b><p>Add a few transactions and your insights will show up here.</p><button class="btn primary" data-act="add">Add a transaction</button></div>`;
    const delta = prev > 0 ? Math.round(((B.spent - prev) / prev) * 100) : null;
    return `<div class="stats" style="margin-top:6px">
      <div class="stat"><div class="k">Spent</div><div class="v">${money(B.spent)}</div>${delta !== null ? `<div class="small ${delta > 0 ? 'over' : 'good'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last month</div>` : ''}</div>
      <div class="stat"><div class="k">Income</div><div class="v good">${money(B.income)}</div></div>
      <div class="stat"><div class="k">Net</div><div class="v ${net < 0 ? 'over' : 'good'}">${net < 0 ? '−' : '+'}${money(Math.abs(net))}</div></div>
      <div class="stat"><div class="k">Daily average</div><div class="v">${money(B.spent / days)}</div></div></div>
      ${rows.length ? `<h2>Where it went</h2><div class="card bars">${rows.map(r => `<div class="b"><div class="row"><span>${r.emoji} ${esc(r.name)}</span><span class="amt">${money(r.spent)} <span class="mute small">${Math.round((r.spent / B.spent) * 100)}%</span></span></div>${bar((r.spent / rows[0].spent) * 100, 'thin ok')}</div>`).join('')}</div>` : ''}
      <h2>Last 6 months</h2><div class="card"><div class="trend" role="img" aria-label="${esc(tr.map(t => `${monthLabel(t.key, { month: 'long' })}: spent ${money(t.spent)}, income ${money(t.income)}`).join('. '))}">
        ${tr.map(t => `<div class="col"><div class="pair"><i class="inc" style="height:${(t.income / max) * 100}%"></i><i style="height:${(t.spent / max) * 100}%"></i></div><div class="lbl">${monthLabel(t.key, { month: 'short' })}</div></div>`).join('')}</div>
        <div class="legend"><span><i class="inc"></i>Income</span><span><i></i>Spent</span></div></div>
      ${top.length ? `<h2>Biggest expenses</h2><ul class="list">${top.map(t => `<li><button class="rowbtn" data-act="tx" data-id="${t.id}"><div class="row"><span class="emoji">${catOf(t.cat)?.emoji ?? '❔'}</span><span class="grow"><div class="title">${esc(t.note || catOf(t.cat)?.name || 'Expense')}</div><div class="small mute">${prettyDate(t.date)}</div></span><span class="amt">${money(t.amount)}</span></div></button></li>`).join('')}</ul>` : ''}`;
  },

  goals() {
    const total = S.goals.reduce((a, g) => a + g.saved, 0);
    const today = L.todayStr();
    return `<h1 class="pagetitle">Goals</h1><p class="mute" style="margin:0 0 12px">${S.goals.length ? `${money(total)} saved across ${plural(S.goals.length, 'goal')}` : 'Save up for something that matters.'}</p>
      ${S.goals.length ? S.goals.map(g => {
        const pct = (g.saved / g.target) * 100, left = L.round2(g.target - g.saved);
        let note = '';
        if (left <= 0) note = '🎉 Goal reached!';
        else if (g.date) {
          const m = L.monthsBetween(today, g.date);
          note = g.date < today ? 'Target date has passed' : `Save about <b>${money(left / Math.max(1, m))}</b>/month to hit ${monthLabel(L.monthOf(g.date), { month: 'short', year: 'numeric' })}`;
        }
        return `<div class="card"><div class="row"><button class="rowbtn grow" style="padding:0" data-act="goal" data-id="${g.id}"><div class="row"><span class="emoji">${g.emoji}</span><span class="grow"><div class="title"><b>${esc(g.name)}</b></div><div class="small mute">${money(g.saved)} of ${money(g.target)}</div></span></div></button>
          <button class="btn" data-act="fund" data-id="${g.id}">Add</button></div>${bar(pct, left <= 0 ? 'inc' : 'ok')}${note ? `<div class="small mute" style="margin-top:8px">${note}</div>` : ''}</div>`;
      }).join('') : `<div class="card empty"><span class="big">🎯</span><b>No goals yet</b><p>An emergency fund, a trip, a new laptop — track it here.</p></div>`}
      <button class="addrow" data-act="addgoal">+ New goal</button>`;
  },

  settings() {
    const st = S.settings;
    return `<h1 class="pagetitle">Settings</h1>
      <h2>Money</h2><div class="list">
        <div class="setrow"><label for="s-income">Monthly income</label><input id="s-income" data-bind="income" type="number" inputmode="decimal" step="any" min="0" value="${st.income || ''}" placeholder="0"></div>
        <div class="setrow"><label for="s-cur">Currency</label><select id="s-cur" data-bind="currency">${L.CURRENCIES.map(([c, n]) => `<option value="${c}" ${c === st.currency ? 'selected' : ''}>${c} · ${n}</option>`).join('')}</select></div>
        <div class="setrow"><label for="s-theme">Appearance</label><select id="s-theme" data-bind="theme">${['auto', 'light', 'dark'].map(t => `<option value="${t}" ${st.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div></div>
      <h2>Recurring &amp; bills <button class="link" data-act="addrec">+ Add</button></h2>
      ${S.recurring.length ? `<ul class="list">${S.recurring.map(r => `<li><button class="rowbtn" data-act="rec" data-id="${r.id}"><div class="row"><span class="emoji">${r.type === 'income' ? '💵' : catOf(r.cat)?.emoji ?? '🔁'}</span><span class="grow"><div class="title">${esc(r.note)}</div><div class="small mute">${L.FREQUENCIES[r.freq]} · next ${prettyDate(r.next)}</div></span><span class="amt ${r.type === 'income' ? 'inc' : ''}">${r.type === 'income' ? '+' : ''}${money(r.amount)}</span></div></button></li>`).join('')}</ul>`
        : `<div class="card empty" style="margin:0"><p>Rent, subscriptions, paychecks — add them once and Calibr logs them for you.</p></div>`}
      <h2>Your data</h2><div class="list">
        <div class="setrow"><span>Export backup (JSON)</span><button class="link" data-act="exportjson">Export</button></div>
        <div class="setrow"><span>Export spreadsheet (CSV)</span><button class="link" data-act="exportcsv">Export</button></div>
        <div class="setrow"><span>Restore from backup</span><button class="link" data-act="import">Choose file</button></div>
        <div class="setrow"><span>Erase everything</span><button class="link over" data-act="reset">Erase…</button></div></div>
      <input id="file" type="file" accept="application/json,.json" hidden>
      <p class="mute small" style="margin:16px 4px">Calibr ${VERSION}. Your data lives only in this browser on this device — nothing is uploaded. Export a backup now and then, especially before clearing browser data or switching phones.</p>`;
  },
};

function txRow(t) {
  const c = catOf(t.cat), inc = t.type === 'income';
  return `<li><button class="rowbtn" data-act="tx" data-id="${t.id}"><div class="row"><span class="emoji">${inc ? '💵' : c?.emoji ?? '❔'}</span>
    <span class="grow"><div class="title">${esc(t.note || (inc ? 'Income' : c?.name ?? 'Expense'))}</div><div class="small mute">${inc ? 'Income' : esc(c?.name ?? 'Uncategorized')}${t.rec ? ' · ↻ recurring' : ''}</div></span>
    <span class="amt ${inc ? 'inc' : ''}">${inc ? '+' : ''}${money(t.amount)}</span></div></button></li>`;
}
function txList() {
  const q = ui.q.trim().toLowerCase();
  let txs = L.monthTx(S, ui.month).filter(t =>
    (ui.type === 'all' || t.type === ui.type) &&
    (ui.cat === 'all' || (ui.cat === 'none' ? t.type === 'expense' && !catOf(t.cat) : t.cat === ui.cat)) &&
    (!q || t.note.toLowerCase().includes(q) || (catOf(t.cat)?.name.toLowerCase().includes(q))));
  if (!txs.length) return `<div class="card empty"><span class="big">🧾</span>${L.monthTx(S, ui.month).length ? 'No transactions match.' : '<b>No transactions this month</b><p>Tap + to add your first one.</p>'}</div>`;
  txs = txs.slice().sort((a, b) => b.date.localeCompare(a.date));
  const groups = new Map();
  for (const t of txs) (groups.get(t.date) ?? groups.set(t.date, []).get(t.date)).push(t);
  return [...groups].map(([d, list]) => {
    const net = list.reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0);
    return `<div class="dayhead"><span>${prettyDate(d)}</span><span>${net < 0 ? '−' : '+'}${money(Math.abs(net))}</span></div><ul class="list" style="border-radius:0;border-top:0">${list.map(txRow).join('')}</ul>`;
  }).join('');
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}
function render() {
  const monthTab = ['budget', 'activity', 'insights'].includes(ui.tab);
  $('top').hidden = !monthTab;
  $('month').textContent = monthLabel(ui.month);
  $('fab').hidden = !['budget', 'activity', 'insights'].includes(ui.tab);
  document.querySelectorAll('#nav button').forEach(b => { b.classList.toggle('on', b.dataset.tab === ui.tab); b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'); });
  $('view').innerHTML = views[ui.tab]();
  applyTheme();
}

// ---------- actions ----------
const shiftMonth = n => { ui.month = L.addMonths(ui.month, n); render(); };
const download = (name, type, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const stamp = () => L.todayStr();

const actions = {
  tab: el => { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  prev: () => shiftMonth(-1),
  next: () => shiftMonth(1),
  thisMonth: () => { ui.month = L.monthOf(L.todayStr()); render(); },
  add: () => txSheet(null),
  addto: el => { closeSheet(); txSheet(null, { cat: el.dataset.id }); },
  tx: el => { const t = S.transactions.find(x => x.id === el.dataset.id); if (t) { closeSheet(); txSheet(t); } },
  cat: el => catDetail(el.dataset.id),
  editcat: el => { const c = catOf(el.dataset.id); if (c) { closeSheet(); catSheet(c); } },
  addcat: () => catSheet(null),
  onboard: () => onboardSheet(),
  addgoal: () => goalSheet(null),
  goal: el => goalSheet(S.goals.find(g => g.id === el.dataset.id)),
  fund: el => fundSheet(S.goals.find(g => g.id === el.dataset.id)),
  addrec: () => recSheet(null),
  rec: el => recSheet(S.recurring.find(r => r.id === el.dataset.id)),
  emoji: el => { el.closest('form').elements.emoji.value = el.dataset.e; },
  setdate: el => { const i = el.closest('.datepick').querySelector('input[type=date]'); i.value = L.addDays(L.todayStr(), +el.dataset.d); i.dispatchEvent(new Event('change', { bubbles: true })); },
  undo: () => { $('toast').hidden = true; toast.undo?.(); toast.undo = null; },
  exportjson: () => download(`calibr-backup-${stamp()}.json`, 'application/json', JSON.stringify(S, null, 2)),
  exportcsv: () => download(`calibr-transactions-${stamp()}.csv`, 'text/csv', L.toCSV(S)),
  import: () => $('file').click(),
  reset: () => {
    if (!confirm('Erase all categories, transactions, goals and settings from this device? Export a backup first if you might want them back.')) return;
    S = L.defaultState(); S.settings.onboarded = true; save(); ui.tab = 'budget'; render(); toast('Everything erased');
  },
};
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (el) actions[el.dataset.act]?.(el, ev);
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'file') {
    const f = t.files[0]; t.value = '';
    if (!f) return;
    f.text().then(txt => {
      let next; try { next = L.sanitize(JSON.parse(txt)); } catch {}
      if (!next) return toast("That doesn't look like a Calibr backup");
      if (!confirm(`Replace everything on this device with the backup (${plural(next.transactions.length, 'transaction')}, ${next.categories.length} categories)?`)) return;
      change('Backup restored', () => { S = next; S.settings.onboarded = true; });
    });
    return;
  }
  const bind = t.dataset?.bind;
  if (bind === 'income') { S.settings.income = Math.max(0, L.round2(parseFloat(t.value) || 0)); save(); toast('Income saved'); }
  else if (bind === 'currency') { S.settings.currency = t.value; save(); render(); }
  else if (bind === 'theme') { S.settings.theme = t.value; save(); applyTheme(); }
  else if (t.id === 'ftype') { ui.type = t.value; $('txlist').innerHTML = txList(); }
  else if (t.id === 'fcat') { ui.cat = t.value; $('txlist').innerHTML = txList(); }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'q') { ui.q = ev.target.value; $('txlist').innerHTML = txList(); }
});

// Swipe left/right on the main views to move between months.
let touch = null;
$('view').addEventListener('touchstart', e => { touch = e.touches.length === 1 && !e.target.closest('input,select') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
$('view').addEventListener('touchend', e => {
  if (!touch || $('top').hidden) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 80 && Math.abs(dy) < 40) shiftMonth(dx < 0 ? 1 : -1);
}, { passive: true });

// Keep multiple open tabs/windows in sync.
window.addEventListener('storage', e => { if (e.key === KEY && e.newValue) { const s = L.sanitize(JSON.parse(e.newValue)); if (s) { S = s; render(); } } });

// Roll the month forward / catch up recurring items when the app comes back to the foreground.
function refresh() {
  const added = L.generateRecurring(S, L.todayStr());
  if (added) { save(); render(); toast(`Added ${plural(added, 'recurring transaction')}`); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// ---------- boot ----------
refresh();
render();
if (!S.settings.onboarded) onboardSheet();
else if (new URLSearchParams(location.search).has('add')) txSheet(null);
if (location.search) history.replaceState(null, '', location.pathname);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
