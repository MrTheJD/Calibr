import * as L from './logic.js';

const KEY = 'calibr.v2', OLD = 'calibr.v1', VERSION = '1.2.0';
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

// ---------- location & places ----------
const geo = { fix: null, state: 'idle', watch: null, onChange: null };
function startLocating(onChange) {
  stopLocating();
  geo.onChange = onChange; geo.fix = null;
  if (!S.settings.locate) { geo.state = 'off'; return; }
  if (!navigator.geolocation) { geo.state = 'unavailable'; return; }
  geo.state = 'locating';
  geo.watch = navigator.geolocation.watchPosition(pos => {
    const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
    if (!geo.fix || f.acc <= geo.fix.acc * 1.2 || f.t - geo.fix.t > 20000) geo.fix = f; // keep the best recent fix
    geo.state = 'ok';
    geo.onChange?.();
    ensurePack(geo.fix).then(() => geo.onChange?.());
  }, err => {
    if (err.code === 1) geo.state = 'denied';
    else if (!geo.fix) geo.state = 'unavailable'; // a timeout after we already have a fix changes nothing
    geo.onChange?.();
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
}
function stopLocating() {
  if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch);
  geo.watch = null; geo.onChange = null;
}

// Offline place packs (see tools/build_pack.py). Fetched once per area, then cached by the service worker.
const packs = { list: null, index: null, entry: null, status: 'idle', pending: null };
async function loadPackList() {
  if (packs.list) return packs.list;
  try { packs.list = (await (await fetch('packs/index.json')).json()).packs || []; } catch { packs.list = []; }
  return packs.list;
}
async function ensurePack(fix) {
  const entry = (await loadPackList()).find(e => L.packCovers(e, fix.lat, fix.lng));
  if (!entry) { packs.entry = packs.index = null; packs.status = 'none'; return; }
  if (packs.entry?.name === entry.name && packs.index) return;
  if (packs.pending?.name === entry.name) return packs.pending.promise;
  packs.status = 'loading';
  const promise = fetch('packs/' + entry.file).then(r => r.json()).then(p => { packs.index = L.buildIndex(p); packs.entry = entry; packs.status = 'ready'; })
    .catch(() => { packs.status = 'error'; }).finally(() => { packs.pending = null; });
  packs.pending = { name: entry.name, promise };
  return promise;
}

// A transaction's remembered place/location, for learning.
const placeOf = t => (t.mkey ? { key: t.mkey, name: t.merchant } : null);
const fixOf = t => (t.loc ? { lat: t.loc[0], lng: t.loc[1] } : null);
// File a transaction under a category and let Calibr learn from it.
function fileTx(t, cat, auto) {
  const was = t.cat, wasAuto = t.auto;
  if (t.cat && !t.status) L.unlearnFiling(S, t);
  t.cat = cat; delete t.status; delete t.sugg;
  if (auto) t.auto = true; else delete t.auto;
  L.learnFiling(S, t, placeOf(t), fixOf(t));
  if (auto) S.learn.stats.auto++;
  if (wasAuto && was && was !== cat) S.learn.stats.fixed++; // an automatic filing the user had to correct
}

// ---------- sheets ----------
const sheet = $('sheet');
function openSheet(html, onSubmit, onMount, primary = 'save') {
  // Hidden first submit button: pressing Enter submits the primary action, not whichever button comes first.
  sheet.innerHTML = `<form method="dialog"><button class="vh" value="${primary}" tabindex="-1" aria-hidden="true"></button><button class="sheetx" value="cancel" formnovalidate aria-label="Close">✕</button>${html}</form>`;
  const form = sheet.firstElementChild;
  form.onsubmit = ev => {
    const v = ev.submitter?.value;
    if (!v || v === 'cancel') return;
    if (onSubmit(v, new FormData(form), form) === false) ev.preventDefault();
  };
  $('toast').hidden = true;
  if (!sheet.open) sheet.showModal();
  onMount?.(form);
  return form;
}
sheet.addEventListener('close', () => { if (!sheet.open) stopLocating(); }); // `open` is true again if another sheet replaced this one
sheet.addEventListener('click', ev => { if (ev.target === sheet) sheet.close(); });
const closeSheet = () => sheet.open && sheet.close();

const KIND_LABEL = { grocery: 'Grocery stores', dining: 'Restaurants & bars', coffee: 'Coffee shops', fuel: 'Gas stations', transport: 'Parking & transit', shopping: 'Shops & retail', health: 'Health & pharmacy', entertainment: 'Entertainment', fitness: 'Gyms & fitness', home: 'Home & hardware', pets: 'Pets', personal: 'Salons & personal care', travel: 'Hotels & travel', education: 'Schools & education', services: 'Other services' };
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
const cap = { picked: null, res: null };
function captureHTML() {
  cap.amount = parseFloat(document.querySelector('#sheet [name=amount]')?.value) || 0;
  const res = cap.res = L.suggest(S, geo.fix, packs.index, cap.amount);
  const fix = geo.fix;
  let line;
  if (geo.state === 'off') line = '📍 Location is off. <button type="button" class="link" data-act="enableloc">Turn on</button>';
  else if (geo.state === 'denied') line = '📍 Location is blocked. Allow it in your browser settings to get suggestions.';
  else if (geo.state === 'unavailable') line = '📍 Couldn’t get your location.';
  else if (!fix) line = '📍 Finding your location…';
  else if (res.cands.some(c => c.p >= 0.15)) {
    const near = res.cands.filter(c => c.p >= 0.15).slice(0, 2);
    line = near.length === 1 && near[0].p >= 0.35
      ? `📍 <b>${esc(near[0].name)}</b> <span class="mute">· ${Math.round(near[0].d)} m away · ±${Math.round(fix.acc)} m</span>`
      : `📍 Near <b>${near.map(c => esc(c.name)).join('</b> or <b>')}</b> <span class="mute">· ±${Math.round(fix.acc)} m</span>`;
  }
  else line = `📍 <span class="mute">±${Math.round(fix.acc)} m · ${packs.status === 'loading' ? 'loading places…' : packs.status === 'none' ? 'no places data for this area yet' : res.spot ? 'a spot you’ve been before' : 'no known place nearby'}</span>`;
  const decision = L.decide(res, S.settings.level, fix, S.learn.stats);
  const top = res.ranked[0];
  let hint = '';
  if (cap.picked) hint = `<span class="good">✓ Will be filed under <b>${esc(catOf(cap.picked)?.name)}</b></span>`;
  else if (!S.categories.length) hint = '';
  else if (decision === 'auto') hint = `<span class="good">✓ Will be filed under <b>${esc(catOf(top.catId).name)}</b> automatically</span>`;
  else if (fix && res.place && top && top.p >= 0.4 && res.margin >= 0.15 && (S.learn.merchants[res.place.key]?.n || 0) < 3) hint = `<span class="warn">New here? Tap <b>${esc(catOf(top.catId).name)}</b> if that's right. After a few visits Calibr will file it by itself.</span>`;
  else if (fix || geo.state === 'off' || geo.state === 'denied') hint = '<span class="warn">Not sure enough to file this by itself — tap a category, or save it and pick later.</span>';
  const chips = res.ranked.map(r => { const c = catOf(r.catId); return c ? `<button type="button" class="chipbtn ${cap.picked === c.id ? 'on' : ''}" data-act="pick" data-id="${c.id}">${c.emoji} ${esc(c.name)}${r.p >= 0.3 ? ` <span class="pct">${Math.round(r.p * 100)}%</span>` : ''}</button>` : ''; }).join('');
  return `<div class="capline">${line}</div>${chips ? `<div class="chips tight">${chips}</div>` : ''}${hint ? `<div class="small caphint">${hint}</div>` : ''}`;
}
function refreshCapture() {
  const el = $('capture');
  if (!el || !sheet.open) return stopLocating();
  el.innerHTML = captureHTML();
  // Fill in what we remember paying here, unless the user has already typed something.
  const amt = document.querySelector('#sheet [name=amount]');
  const m = cap.res.place && cap.res.place.p >= 0.5 && S.learn.merchants[cap.res.place.key];
  if (amt && m?.amt && !amt.dataset.touched && amt.dataset.filled !== cap.res.place.key) { amt.value = m.amt; amt.dataset.filled = cap.res.place.key; amt.select?.(); }
}

function txSheet(tx, preset = {}) {
  const editing = !!tx;
  const type = tx?.type ?? preset.type ?? 'expense';
  const date = tx?.date ?? L.todayStr();
  const recent = [...new Set(S.transactions.slice().reverse().map(t => t.note).filter(Boolean))].slice(0, 40);
  cap.picked = !editing && preset.cat && catOf(preset.cat) ? preset.cat : null;
  const selCat = tx ? tx.cat : cap.picked;
  const amount0 = tx ? tx.amount : (S.settings.lastAmount || '');
  openSheet(`
    <h3>${editing ? 'Edit' : 'Add'} transaction</h3>
    <div class="field">${typeSeg(type)}</div>
    <div class="field"><label for="f-amount" class="vh">Amount</label>
      <input id="f-amount" class="amount" name="amount" type="number" inputmode="decimal" step="any" min="0.01" placeholder="0.00" value="${amount0}" required></div>
    ${editing ? '' : '<div id="capture" class="capture"></div>'}
    ${editing && tx.status === 'review' ? '<p class="small warn" style="margin:0">Needs a category — pick one below.</p>' : ''}
    <details id="more" class="more" ${editing ? 'open' : ''}><summary>${editing ? 'Details' : 'Category, note & date'}</summary>
      <div class="field" id="catfield"><span class="lab">Category</span>${catChips(selCat)}</div>
      <div class="field"><label for="f-note">Note (optional)</label>
        <input id="f-note" name="note" type="text" maxlength="80" list="notes" autocomplete="off" placeholder="What was it for?" value="${esc(tx?.note)}">
        <datalist id="notes">${recent.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      ${dateField(date)}
      ${editing && tx.type === 'expense' ? `<button type="button" class="link" data-act="split" data-id="${tx.id}">Split across categories…</button>` : ''}
    </details>
    <div class="actions">${editing ? '<button class="btn danger spacer" value="delete" formnovalidate>Delete</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}
      <button class="btn primary" value="save">${editing ? 'Save' : 'Add'}</button></div>`,
  (v, fd) => {
    if (v === 'delete') { change('Transaction deleted', () => { L.unlearnFiling(S, tx); S.transactions = S.transactions.filter(t => t.id !== tx.id); }); return; }
    const amount = L.round2(parseFloat(fd.get('amount')));
    if (!(amount > 0)) return false;
    const t = fd.get('type') === 'income' ? 'income' : 'expense';
    const note = String(fd.get('note') || '').trim(), date = fd.get('date');
    const chosen = t === 'expense' ? (fd.get('cat') || cap.picked || null) : null;

    if (editing) {
      change('Transaction updated', () => {
        const x = S.transactions.find(q => q.id === tx.id);
        const was = x.cat, wasAuto = x.auto, hadStatus = x.status;
        if (was && !hadStatus) L.unlearnFiling(S, x); // with the old amount, before it changes
        Object.assign(x, { type: t, amount, note, date });
        x.cat = null;
        if (t === 'income') { delete x.status; delete x.sugg; delete x.auto; }
        else if (chosen) { fileTx(x, chosen, false); S.settings.lastCat = chosen; if (wasAuto && was) S.learn.stats[was === chosen ? 'confirmed' : 'fixed']++; }
        else if (!hadStatus) delete x.auto;
      });
      return;
    }

    // New transaction: decide whether it can be filed by itself.
    const fix = geo.fix && t === 'expense' ? geo.fix : null;
    const res = L.suggest(S, geo.fix, packs.index, amount); // recompute with the final amount
    const place = res?.place && res.place.p >= 0.35 ? { key: res.place.key, name: res.place.name } : null;
    const base = { id: L.uid(), type: t, amount, cat: null, note, date };
    if (t === 'expense' && fix && fix.acc <= 150) {
      base.loc = [Math.round(fix.lat * 1e4) / 1e4, Math.round(fix.lng * 1e4) / 1e4];
      if (place) { base.merchant = place.name; base.mkey = place.key; }
      else { const near = res.cands.filter(c => c.p >= 0.15).slice(0, 2).map(c => c.name); if (near.length) base.near = near; }
    }
    let msg;
    if (t === 'income') {
      const mk = date.slice(0, 7), plan = L.planIncome(S, mk);
      msg = `Added ${money(amount)} income`;
      if (S.settings.incomeMode === 'varies' && plan > 0) { const got = L.budgetFor(S, mk).earned + amount; msg += got >= plan ? ` · ${money(got - plan)} above your plan` : ` · ${money(plan - got)} to reach your plan`; }
    }
    else if (chosen) { msg = `Added ${money(amount)} to ${catOf(chosen).name}`; }
    else if (L.decide(res, S.settings.level, fix, S.learn.stats) === 'auto') { base.__auto = res.ranked[0].catId; msg = `Filed ${money(amount)} under ${catOf(base.__auto).name}${place ? ' · ' + place.name : ''}`; }
    else { base.status = 'review'; base.sugg = res.ranked.slice(0, 3).map(r => r.catId); msg = `Saved ${money(amount)} — it needs a category`; }
    change(msg, () => {
      const auto = base.__auto; delete base.__auto;
      S.transactions.push(base);
      if (chosen) { fileTx(base, chosen, false); S.settings.lastCat = chosen; }
      else if (auto) fileTx(base, auto, true);
      if (t === 'expense') S.settings.lastAmount = amount;
    });
    if (date.slice(0, 7) !== ui.month && ui.tab !== 'settings' && ui.tab !== 'goals') { ui.month = date.slice(0, 7); render(); }
  },
  form => {
    const toggle = () => { const inc = form.elements.type.value === 'income'; $('catfield').hidden = inc; if ($('capture')) $('capture').hidden = inc; };
    form.addEventListener('change', e => { if (e.target.name === 'type') toggle(); if (e.target.name === 'cat') { cap.picked = e.target.value || null; if ($('capture')) refreshCapture(); } });
    toggle();
    const amt = form.elements.amount;
    let tm;
    amt.addEventListener('input', () => { amt.dataset.touched = '1'; if ($('capture')) { clearTimeout(tm); tm = setTimeout(refreshCapture, 200); } });
    if (!editing) {
      startLocating(refreshCapture);
      refreshCapture();
      setTimeout(() => { amt.focus(); amt.select(); }, 50);
    }
    // With no location help, fall back to remembering which category a note went to last time.
    form.elements.note.addEventListener('input', e => {
      if (cap.picked || form.elements.cat.value) return;
      const key = e.target.value.trim().toLowerCase();
      const m = key && S.transactions.slice().reverse().find(t => t.type === 'expense' && t.cat && t.note.toLowerCase() === key);
      if (m) { const r = form.querySelector(`input[name=cat][value="${m.cat}"]`); if (r) { r.checked = true; cap.picked = m.cat; refreshCapture(); } }
    });
  });
}

// ---- split ----
let splitRow = () => '';
function splitSheet(tx) {
  if (!S.categories.length) return;
  const opts = sel => S.categories.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
  splitRow = sel => `<div class="splitrow"><select name="sc" aria-label="Category">${opts(sel)}</select><input name="sa" type="number" inputmode="decimal" step="any" min="0.01" placeholder="0.00" aria-label="Amount"></div>`;
  const first = catOf(tx.cat) ? tx.cat : tx.sugg?.find(catOf) ?? S.categories[0].id;
  const second = tx.sugg?.find(id => id !== first && catOf(id)) ?? S.categories.find(c => c.id !== first)?.id ?? first;
  openSheet(`<h3>Split ${money(tx.amount)}</h3>
    <p class="mute small" style="margin:0 0 8px">Divide this purchase across categories, e.g. groceries and household at the same store.</p>
    <div id="splitrows">${splitRow(first)}${splitRow(second)}</div>
    <button type="button" class="addrow" data-act="addsplit">+ Add another</button>
    <div id="remain" class="small" style="margin:10px 2px"></div>
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="save">Split</button></div>`,
  (v, fd) => {
    const cs = fd.getAll('sc'), rows = fd.getAll('sa').map((a, i) => ({ cat: cs[i], amount: L.round2(parseFloat(a) || 0) })).filter(r => r.amount > 0);
    const sum = L.round2(rows.reduce((a, r) => a + r.amount, 0));
    if (rows.length < 2 || sum !== L.round2(tx.amount)) { $('remain').innerHTML = `<span class="over">${rows.length < 2 ? 'Enter amounts for at least two categories.' : `The parts add up to ${money(sum)}, not ${money(tx.amount)}.`}</span>`; return false; }
    change(`Split into ${rows.length} categories`, () => {
      const x = S.transactions.find(t => t.id === tx.id);
      if (x.cat && !x.status) L.unlearnFiling(S, x);
      x.cat = null; delete x.status; delete x.sugg; delete x.auto;
      L.splitTx(S, x, rows).forEach((t, i) => fileTx(t, rows[i].cat, false));
    });
  },
  form => {
    const update = e => {
      const inputs = [...form.querySelectorAll('[name=sa]')];
      if (e?.target.name === 'sa' && e.target === inputs[0] && inputs.length === 2 && !inputs[1].dataset.touched) {
        const rest = L.round2(tx.amount - (parseFloat(inputs[0].value) || 0));
        inputs[1].value = rest > 0 ? rest : '';
      } else if (e?.target.name === 'sa') e.target.dataset.touched = '1';
      const sum = L.round2(inputs.reduce((a, i) => a + (parseFloat(i.value) || 0), 0)), diff = L.round2(tx.amount - sum);
      $('remain').innerHTML = diff === 0 ? '<span class="good">✓ Adds up</span>' : diff > 0 ? `${money(diff)} left to assign` : `<span class="over">${money(-diff)} over</span>`;
    };
    form.addEventListener('input', update);
    update();
    setTimeout(() => form.querySelector('[name=sa]').focus(), 50);
  });
}

// ---- review pile ----
let rvUndo = null;
function reviewSheet(note) {
  const list = L.reviewList(S);
  const undoBar = note ? `<div class="undobar"><span>${esc(note)}</span>${rvUndo ? '<button type="button" class="link" data-act="rvundo">Undo</button>' : ''}</div>` : '';
  if (!list.length) {
    openSheet(`<h3>All caught up 🎉</h3>${undoBar}<p class="mute">Nothing needs a category right now.</p><div class="actions"><button class="btn primary" value="cancel" formnovalidate>Done</button></div>`);
    return;
  }
  const fallback = S.categories.slice(0, 3).map(c => c.id);
  openSheet(`<h3>Needs a category</h3>${undoBar}
    <p class="mute small" style="margin:0 0 6px">One tap files each one. Calibr learns from your choices, so there will be fewer of these over time.</p>
    ${list.map(t => `<div class="rv"><div class="row"><span class="grow"><b>${money(t.amount)}</b> <span class="mute">${esc(t.merchant || t.note || (t.near ? 'near ' + t.near.join(' or ') : 'Expense'))} · ${prettyDate(t.date)}</span></span>
      <button type="button" class="del" data-act="rvdel" data-id="${t.id}" aria-label="Delete">✕</button></div>
      <div class="chips tight">${(t.sugg?.length ? t.sugg : fallback).map(id => catOf(id)).filter(Boolean).map(c => `<button type="button" class="chipbtn" data-act="resolve" data-id="${t.id}" data-cat="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('')}
      <button type="button" class="chipbtn ghost" data-act="rvother" data-id="${t.id}">Other…</button>
      <button type="button" class="chipbtn ghost" data-act="split" data-id="${t.id}">Split…</button></div></div>`).join('')}
    <div class="actions"><button class="btn primary" value="cancel" formnovalidate>Done</button></div>`);
}
function reviewChange(msg, fn) {
  const before = JSON.stringify(S);
  fn(); save(); render();
  rvUndo = () => { S = L.sanitize(JSON.parse(before)); save(); render(); };
  reviewSheet(msg);
}

// ---- auto-filed check ----
function autoSheet(note) {
  const list = L.autoUnconfirmed(S, L.todayStr());
  const undoBar = note ? `<div class="undobar"><span>${esc(note)}</span>${rvUndo ? '<button type="button" class="link" data-act="rvundo2">Undo</button>' : ''}</div>` : '';
  if (!list.length) { openSheet(`<h3>All checked 👍</h3>${undoBar}<p class="mute">Thanks. Calibr learns from every one you confirm or fix.</p><div class="actions"><button class="btn primary" value="cancel" formnovalidate>Done</button></div>`); return; }
  openSheet(`<h3>Filed automatically</h3>${undoBar}
    <p class="mute small" style="margin:0 0 6px">Was Calibr right? Confirm, or tap Change. If it keeps getting things wrong it will ask you more often.</p>
    ${list.slice(0, 12).map(t => { const c = catOf(t.cat); return `<div class="rv"><div class="row"><span class="grow"><b>${money(t.amount)}</b> <span class="mute">${esc(t.merchant || t.note || 'Purchase')} · ${prettyDate(t.date)}</span><div>${c ? `${c.emoji} ${esc(c.name)}` : ''}</div></span>
      <button type="button" class="chipbtn ghost" data-act="rvother" data-id="${t.id}">Change</button> <button type="button" class="chipbtn on" data-act="confirm" data-id="${t.id}">✓ Right</button></div></div>`; }).join('')}
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Close</button>${list.length > 1 ? '<button class="btn primary" type="button" data-act="confirmall">All look right</button>' : ''}</div>`);
}
function autoChange(msg, fn) {
  const before = JSON.stringify(S);
  fn(); save(); render();
  rvUndo = () => { S = L.sanitize(JSON.parse(before)); save(); render(); };
  autoSheet(msg);
}

// ---- location check ----
function diagSheet() {
  openSheet(`<h3>Location check</h3><p class="mute small" style="margin:0 0 8px">Shows what Calibr sees right now. Nothing is saved.</p><div id="diag" class="small"></div>
    <div class="actions"><button class="btn" type="button" data-act="diag">Run again</button><button class="btn primary" value="cancel" formnovalidate>Done</button></div>`);
  const out = $('diag'), rows = [];
  const show = () => { out.innerHTML = rows.map(([k, v, ok]) => `<div class="setrow" style="padding:8px 0"><span>${k}</span><span class="${ok === true ? 'good' : ok === false ? 'over' : 'mute'}" style="text-align:right;max-width:65%">${v}</span></div>`).join(''); };
  rows.push(['Secure page (https)', window.isSecureContext ? 'Yes' : 'No: location needs https', window.isSecureContext]);
  rows.push(['Location in Calibr settings', S.settings.locate ? 'On' : 'Off', S.settings.locate]);
  show();
  navigator.permissions?.query({ name: 'geolocation' }).then(r => { rows.push(['Browser permission', r.state === 'granted' ? 'Allowed' : r.state === 'denied' ? 'Blocked' : 'Will ask', r.state === 'granted' ? true : r.state === 'denied' ? false : null]); show(); }).catch(() => {});
  if (!navigator.geolocation) { rows.push(['GPS', 'Not available in this browser', false]); show(); return; }
  const gps = ['GPS', 'Looking…', null];
  rows.push(gps); show();
  navigator.geolocation.getCurrentPosition(async pos => {
    const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    gps[0] = 'GPS fix'; gps[1] = `±${Math.round(fix.acc)} m`; gps[2] = fix.acc <= 50 ? true : fix.acc <= 150 ? null : false; show();
    await ensurePack(fix);
    rows.push(['Places data', packs.entry ? `${esc(packs.entry.label)}, ${packs.entry.places.toLocaleString()} places` : (packs.list?.length ? 'None covers this spot' : 'None installed'), !!packs.entry]);
    const res = L.suggest(S, fix, packs.index, 0);
    rows.push(['Nearby', res.cands.length ? res.cands.map(c => `${esc(c.name)} (${Math.round(c.d)} m)`).join('<br>') : 'Nothing listed within range', res.cands.length ? true : null]);
    const top = res.ranked.filter(r => r.p > 0 && catOf(r.catId));
    rows.push(['Would suggest', top.length ? top.map(r => `${esc(catOf(r.catId).name)} ${Math.round(r.p * 100)}%`).join(', ') : 'Nothing yet', null]);
    rows.push(['Would auto-file', L.decide(res, S.settings.level, fix, S.learn.stats) === 'auto' ? 'Yes' : 'No, it would ask you', null]);
    show();
  }, err => { gps[1] = err.code === 1 ? 'Blocked. Allow location for this site in your browser or phone settings.' : err.code === 3 ? 'Timed out. Try outdoors or near a window.' : 'Unavailable'; gps[2] = false; show(); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

// ---- variable income ----
function ensureBuffer(plan) {
  let g = L.bufferGoal(S);
  if (!g) { g = { id: L.uid(), emoji: '🛟', name: 'Income buffer', target: Math.max(1000, L.round2(plan * 3)), saved: 0, date: '', buffer: true }; S.goals.push(g); }
  return g;
}
function bufferSheet() {
  const IS = L.incomeStatus(S, ui.month);
  if (!(IS.surplus > 0)) return;
  openSheet(`<h3>Save in your buffer</h3>
    <p class="mute small" style="margin:0">You received ${money(IS.earned)} against a plan of ${money(IS.plan)}. Setting the extra aside means a lean month won't cut into your essentials.</p>
    <div class="field"><label for="f-amount" class="vh">Amount</label><input id="f-amount" class="amount" name="amount" type="number" inputmode="decimal" step="any" min="0.01" max="${IS.surplus}" value="${IS.surplus}" required></div>
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Not now</button><button class="btn primary" value="save">Move to buffer</button></div>`,
  (v, fd) => {
    const amt = Math.min(IS.surplus, L.round2(parseFloat(fd.get('amount'))));
    if (!(amt > 0)) return false;
    change(`Saved ${money(amt)} in your buffer`, () => {
      ensureBuffer(IS.plan).saved = L.round2(ensureBuffer(IS.plan).saved + amt);
      S.settings.moved[ui.month] = L.round2((S.settings.moved[ui.month] || 0) + amt);
    });
  }, form => setTimeout(() => { form.elements.amount.focus(); form.elements.amount.select(); }, 50));
}
function useBuffer() {
  const buf = L.bufferGoal(S), today = L.todayStr(), IS = L.incomeStatus(S, L.monthOf(today));
  const amt = buf ? Math.min(buf.saved, IS.gap) : 0;
  if (!(amt > 0)) return;
  change(`Moved ${money(amt)} from your buffer`, () => {
    buf.saved = L.round2(buf.saved - amt);
    S.transactions.push({ id: L.uid(), type: 'income', amount: amt, cat: null, note: 'From buffer', date: today, src: 'buffer' });
  });
}

function leanSheet() {
  const key = ui.month, IS = L.incomeStatus(S, key);
  const baseState = { ...S, overrides: { ...S.overrides, [key]: undefined } }; // always plan from the normal limits, never compound
  const hasAdj = !!S.overrides[key];
  const start = IS.earned > 0 ? IS.earned : IS.plan;
  const out = avail => {
    const p = L.leanPlan(baseState, key, avail);
    const names = Object.fromEntries(S.categories.map(c => [c.id, c]));
    return `<div class="stats"><div class="stat"><div class="k">Essentials</div><div class="v">${money(p.eTot)}</div></div><div class="stat"><div class="k">Left for the rest</div><div class="v ${p.room < 0 ? 'over' : ''}">${money(p.room)}</div></div></div>
      ${p.shortfall > 0 ? `<p class="small over">Essentials alone are ${money(p.shortfall)} more than this. ${L.bufferGoal(S)?.saved > 0 ? 'Your buffer can help.' : 'Consider trimming an essential or finding extra income.'}</p>` : ''}
      ${p.factor >= 1 ? '<p class="small good">✓ Your normal limits fit. Nothing to trim.</p>' : `<ul class="list" style="margin-top:8px">${p.suggestions.map(x => `<li><div class="rowbtn"><div class="row"><span class="emoji">${names[x.id].emoji}</span><span class="grow">${esc(names[x.id].name)}</span><span class="amt"><span class="mute">${money(x.from)} →</span> <b>${money(x.to)}</b></span></div></div></li>`).join('')}</ul>`}`;
  };
  openSheet(`<h3>Plan a lean month</h3>
    <p class="mute small" style="margin:0">Essentials stay fully funded. Flexible categories shrink to fit what you can count on. This only changes ${monthLabel(key)}.</p>
    <div class="field"><label for="f-avail">Money I can count on this month</label><input id="f-avail" name="avail" type="number" inputmode="decimal" step="any" min="0" value="${start || ''}" required>
      <div class="quick"><button type="button" class="btn" data-act="setavail" data-v="${IS.earned}">Received so far</button><button type="button" class="btn" data-act="setavail" data-v="${IS.plan}">My plan</button></div></div>
    <div id="leanout">${out(start)}</div>
    <div class="actions">${hasAdj ? '<button class="btn danger spacer" value="reset" formnovalidate>Reset</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}<button class="btn primary" value="save">Apply to ${monthLabel(key, { month: 'long' })}</button></div>`,
  (v, fd) => {
    if (v === 'reset') { change('Month limits reset', () => { delete S.overrides[key]; }); return; }
    const p = L.leanPlan(baseState, key, parseFloat(fd.get('avail')) || 0);
    if (p.factor >= 1) return; // nothing to trim
    change('Lean-month limits applied', () => { S.overrides[key] = Object.fromEntries(p.suggestions.filter(x => x.to !== x.from).map(x => [x.id, x.to])); });
  },
  form => {
    form.elements.avail.addEventListener('input', () => { $('leanout').innerHTML = out(parseFloat(form.elements.avail.value) || 0); });
  });
}

function monthLimitSheet(id) {
  const c = catOf(id); if (!c) return;
  const eff = L.limitFor(S, c, ui.month), adj = eff !== c.limit;
  openSheet(`<h3>${c.emoji} ${esc(c.name)}: ${monthLabel(ui.month, { month: 'long' })} only</h3>
    <p class="mute small" style="margin:0">Your usual limit is ${money(c.limit)}. Change it just for this month.</p>
    <div class="field"><label for="f-limit">Limit this month</label><input id="f-limit" name="limit" type="number" inputmode="decimal" step="any" min="0" value="${eff}" required></div>
    <div class="actions">${adj ? '<button class="btn danger spacer" value="reset" formnovalidate>Use usual</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}<button class="btn primary" value="save">Save</button></div>`,
  (v, fd) => {
    change('Limit updated for this month', () => {
      const o = S.overrides[ui.month] ??= {};
      const val = Math.max(0, L.round2(parseFloat(fd.get('limit')) || 0));
      if (v === 'reset' || val === c.limit) delete o[id]; else o[id] = val;
      if (!Object.keys(o).length) delete S.overrides[ui.month];
    });
  }, form => setTimeout(() => form.elements.limit.select(), 50));
}

// ---- category sheets ----
function catSheet(cat) {
  const editing = !!cat;
  openSheet(`
    <h3>${editing ? 'Edit' : 'New'} category</h3>
    <div class="field"><label for="f-emoji">Icon</label><input id="f-emoji" name="emoji" type="text" value="${esc(cat?.emoji ?? '🏷️')}" style="width:5rem;text-align:center;font-size:1.4rem">${emojiPicker()}</div>
    <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" maxlength="40" required value="${esc(cat?.name)}" placeholder="e.g. Groceries"></div>
    <div class="field"><label for="f-limit">Monthly limit</label><input id="f-limit" name="limit" type="number" inputmode="decimal" step="any" min="0" value="${cat?.limit ?? ''}" placeholder="0" required></div>
    <div class="field"><label for="f-kind">Place type (for location suggestions)</label><select id="f-kind" name="kind"><option value="">Auto: ${esc(L.kindsOf({ name: cat?.name ?? '' }).join(', ') || 'none')}</option>${L.KINDS.map(k => `<option value="${k}" ${cat?.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></div>
    <div class="field"><label class="check"><input type="checkbox" name="essential" ${cat?.essential ? 'checked' : ''}><span>Essential<br><span class="mute small">Covered first. In a lean month, flexible categories shrink before this one.</span></span></label></div>
    <div class="field"><label class="check"><input type="checkbox" name="rollover" ${cat?.rollover ? 'checked' : ''}><span>Carry unspent money into next month<br><span class="mute small">Starts from this month. Overspending doesn't carry over.</span></span></label></div>
    <div class="actions">${editing ? '<button class="btn danger spacer" value="delete" formnovalidate>Delete</button>' : '<button class="btn" value="cancel" formnovalidate>Cancel</button>'}
      <button class="btn primary" value="save">Save</button></div>`,
  (v, fd) => {
    if (v === 'delete') {
      change(`${cat.name} deleted`, () => {
        S.categories = S.categories.filter(c => c.id !== cat.id);
        S.transactions.forEach(t => { if (t.cat === cat.id) t.cat = null; });
        S.recurring.forEach(r => { if (r.cat === cat.id) r.cat = null; });
        S = L.sanitize(JSON.parse(JSON.stringify(S))); // drops the deleted category from learned data and suggestions
      });
      return;
    }
    const name = String(fd.get('name')).trim();
    if (!name) return false;
    const rollover = fd.get('rollover') === 'on';
    const data = { emoji: firstGlyph(fd.get('emoji')) || '🏷️', name, limit: Math.max(0, L.round2(parseFloat(fd.get('limit')) || 0)), rollover, kind: fd.get('kind') || undefined, essential: fd.get('essential') === 'on' };
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
      <div class="stat"><div class="k">Spent of ${money(row.avail)}${row.adjusted ? ' (adjusted)' : ''}</div><div class="v">${money(row.spent)}</div></div></div>
    ${row.carry > 0 ? `<p class="small mute">Includes ${money(row.carry)} carried over from earlier months.</p>` : ''}
    ${txs.length ? `<ul class="list">${txs.map(t => `<li><button type="button" class="rowbtn" data-act="tx" data-id="${t.id}"><div class="row"><span class="grow"><div class="title">${esc(t.note || row.cat.name)}</div><div class="small mute">${prettyDate(t.date)}</div></span><span class="amt">${money(t.amount)}</span></div></button></li>`).join('')}</ul>` : '<p class="empty">Nothing spent here yet.</p>'}
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Close</button>
      <button class="btn" type="button" data-act="monthlimit" data-id="${id}">This month…</button>
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
    <p class="mute" style="margin:0 0 4px">Log a purchase in seconds. Calibr uses where you are to guess the category, and you set a limit for each one. Everything stays on this device.</p>
    <div class="field"><span class="lab">Pick the categories you'll use (5–6 is plenty)</span>
      <div class="chips">${L.PRESETS.map(([emoji, name, , , on]) => `<label><input class="vh" type="checkbox" name="cats" value="${esc(name)}" ${on ? 'checked' : ''}><span>${emoji} ${esc(name)}</span></label>`).join('')}</div></div>
    <div class="field"><span class="lab">My pay is</span><div class="seg" role="radiogroup"><label><input class="vh" type="radio" name="pay" value="steady" checked><span>Steady</span></label><label><input class="vh" type="radio" name="pay" value="varies"><span>Different each time</span></label></div></div>
    <div class="field"><label for="f-income">Monthly income after tax, or a typical low month if it varies (optional)</label><input id="f-income" name="income" type="number" inputmode="decimal" step="any" min="0" placeholder="Used to suggest limits"></div>
    <div class="field"><label for="f-cur">Currency</label><select id="f-cur" name="currency">${L.CURRENCIES.map(([c, n]) => `<option value="${c}" ${c === S.settings.currency ? 'selected' : ''}>${c} · ${n}</option>`).join('')}</select></div>
    <div class="field"><label class="check"><input type="checkbox" name="locate" checked><span>Use my location to suggest categories<br><span class="mute small">Only while you're adding a purchase. Never leaves your device.</span></span></label></div>
    <div class="actions"><button class="btn" value="skip" formnovalidate>Skip</button><button class="btn primary" value="go">Get started</button></div>`,
  (v, fd) => {
    S.settings.onboarded = true;
    if (v === 'go') {
      const income = Math.max(0, L.round2(parseFloat(fd.get('income')) || 0));
      S.settings.currency = fd.get('currency');
      S.settings.income = income;
      S.settings.incomeMode = fd.get('pay') === 'varies' ? 'varies' : 'steady';
      S.settings.locate = fd.get('locate') === 'on';
      if (!S.categories.length) S.categories = L.fromPresets(fd.getAll('cats'), income);
      if (S.settings.locate) navigator.geolocation?.getCurrentPosition(() => {}, () => {}, { timeout: 10000 }); // ask for permission now, while the user expects it
    }
    save(); render();
  }, null, 'go');
}
sheet.addEventListener('close', () => { if (!S.settings.onboarded && sheet.querySelector('[name=cats]')) { S.settings.onboarded = true; save(); render(); } });

// ---------- views ----------
// Where to run the "Build places pack" workflow, when the app is served from GitHub Pages.
function packBuilderUrl() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/), repo = location.pathname.split('/')[1];
  return m && repo ? `https://github.com/${m[1]}/${repo}/actions/workflows/build-pack.yml` : '';
}
function placesStatus() {
  if (packs.entry) return `${esc(packs.entry.label)} · ${packs.entry.places.toLocaleString()} places`;
  if (!packs.list) { loadPackList().then(() => ui.tab === 'settings' && render()); return 'Checking…'; }
  if (!packs.list.length) return 'None installed. Calibr will learn the places you visit; see the README to add a city.';
  return 'Loads automatically when you add a purchase in a covered area.';
}

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
    const varies = S.settings.incomeMode === 'varies';
    const IS = L.incomeStatus(S, ui.month);
    const inc = IS.plan;
    const unassigned = L.round2(inc - B.limits);
    const unassignedTxt = `<span class="${unassigned < 0 ? 'over' : ''}">${unassigned < 0 ? `Limits exceed plan by ${money(-unassigned)}` : `${money(unassigned)} unassigned`}</span>`;
    let incomeLine, incomeHint = '';
    if (varies) {
      incomeLine = inc > 0 ? `<span>Plan ${money(inc)} · received ${money(IS.earned)}${IS.drawn > 0 ? ` + ${money(IS.drawn)} buffer` : ''}</span>${unassignedTxt}`
        : `<button class="link small" data-act="tab" data-tab="settings">Set a starting income estimate →</button><span></span>`;
      const buf = L.bufferGoal(S);
      if (inc > 0 && IS.surplus > 0) incomeHint = `<div class="hint">💰 <b>${money(IS.surplus)}</b> above your plan. <button class="link" data-act="tobuffer">Save it in your buffer</button></div>`;
      else if (inc > 0 && IS.gap > 0) incomeHint = `<div class="hint">${money(IS.gap)} to go to reach your plan.${cur ? ` <button class="link" data-act="lean">Plan a lean month</button>` : ''}${cur && buf?.saved > 0 ? ` <button class="link" data-act="usebuffer">Use buffer</button>` : ''}</div>`;
    } else {
      incomeLine = inc > 0
        ? `<span>Income ${money(inc)}</span>${unassignedTxt}`
        : `<button class="link small" data-act="tab" data-tab="settings">Set your monthly income →</button><span></span>`;
    }
    const upcoming = cur ? L.upcoming(S, today, 14) : [];
    const nReview = L.reviewList(S).length;
    const nAuto = L.autoUnconfirmed(S, today).length;
    const autoCard = nAuto ? `<button class="card autocard" data-act="autoreview"><span class="emoji">📍</span><span class="grow">${plural(nAuto, 'purchase')} filed automatically<br><span class="small mute">Glance over ${nAuto === 1 ? 'it' : 'them'} so Calibr learns what it got right</span></span><span class="link">Check ›</span></button>` : '';
    const banner = nReview ? `<button class="card banner" data-act="review"><span class="emoji">📥</span><span class="grow"><b>${plural(nReview, 'purchase')} need${nReview === 1 ? 's' : ''} a category</b><br><span class="small mute">One tap each to file them</span></span><span class="link">Review ›</span></button>` : '';
    return `${banner}<section class="card hero"><div class="label">Left this month</div>
      <div class="big ${B.left < 0 ? 'over' : ''}">${money(B.left)}</div>${bar(pct)}
      <div class="sub"><span>${money(B.spent)} spent</span><span>of ${money(B.budget)}</span></div>
      <div class="sub">${incomeLine}</div>${hint ? `<div class="hint">${hint}</div>` : ''}${incomeHint}</section>
      ${autoCard}
      ${upcoming.length ? `<h2>Coming up</h2><ul class="list">${upcoming.map(r => {
        const d = L.daysBetween(today, r.next);
        return `<li><button class="rowbtn" data-act="rec" data-id="${r.id}"><div class="row"><span class="emoji">${r.type === 'income' ? '💵' : catOf(r.cat)?.emoji ?? '🔁'}</span><span class="grow"><div class="title">${esc(r.note)}</div><div class="small mute">${d === 1 ? 'Tomorrow' : `In ${plural(d, 'day')}`}</div></span><span class="amt ${r.type === 'income' ? 'inc' : ''}">${r.type === 'income' ? '+' : ''}${money(r.amount)}</span></div></button></li>`;
      }).join('')}</ul>` : ''}
      <h2>Categories</h2>
      <ul class="list">${B.cats.map(r => `<li><button class="rowbtn" data-act="cat" data-id="${r.cat.id}">
        <div class="row"><span class="emoji">${r.cat.emoji}</span><span class="grow"><div class="title">${esc(r.cat.name)}</div>
        <div class="small mute">${money(r.spent)} of ${money(r.avail)}${r.carry > 0 ? ` · +${money(r.carry)} carried` : ''}${r.adjusted ? ' · adjusted' : ''}</div></span>
        <span class="amt ${r.left < 0 ? 'over' : ''}"><b>${money(Math.abs(r.left))}</b> <span class="mute small">${r.left < 0 ? 'over' : 'left'}</span></span></div>${bar(r.pct, 'thin')}</button></li>`).join('')}
        ${B.uncategorized > 0 ? `<li><div class="rowbtn"><div class="row"><span class="emoji">❔</span><span class="grow"><div class="title">${L.reviewList(S).length ? 'Needs a category' : 'Uncategorized'}</div><div class="small mute">Counted in your total, not in a category</div></span><span class="amt">${money(B.uncategorized)}</span></div></div></li>` : ''}
      </ul>
      <button class="addrow" data-act="addcat">+ Add category</button>`;
  },

  activity() {
    const txs = L.monthTx(S, ui.month);
    const inc = txs.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    return `<div class="stats" style="margin-top:6px"><div class="stat"><div class="k">Spent</div><div class="v">${money(exp)}</div></div><div class="stat"><div class="k">Income</div><div class="v good">${money(inc)}</div></div></div>
      <div class="filters"><input id="q" type="search" placeholder="Search notes" aria-label="Search" value="${esc(ui.q)}">
      <select id="ftype" aria-label="Type"><option value="all">All types</option><option value="expense" ${ui.type === 'expense' ? 'selected' : ''}>Expenses</option><option value="income" ${ui.type === 'income' ? 'selected' : ''}>Income</option><option value="review" ${ui.type === 'review' ? 'selected' : ''}>Needs category</option><option value="auto" ${ui.type === 'auto' ? 'selected' : ''}>Auto-filed</option></select>
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
    if (!rows.length && !B.income && !L.incomeStats(S, ui.month)) return `<div class="card empty"><span class="big">📊</span><b>Nothing to analyze yet</b><p>Add a few transactions and your insights will show up here.</p><button class="btn primary" data-act="add">Add a transaction</button></div>`;
    const delta = prev > 0 ? Math.round(((B.spent - prev) / prev) * 100) : null;
    return `<div class="stats" style="margin-top:6px">
      <div class="stat"><div class="k">Spent</div><div class="v">${money(B.spent)}</div>${delta !== null ? `<div class="small ${delta > 0 ? 'over' : 'good'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last month</div>` : ''}</div>
      <div class="stat"><div class="k">Income</div><div class="v good">${money(B.income)}</div></div>
      <div class="stat"><div class="k">Net</div><div class="v ${net < 0 ? 'over' : 'good'}">${net < 0 ? '−' : '+'}${money(Math.abs(net))}</div></div>
      <div class="stat"><div class="k">Daily average</div><div class="v">${money(B.spent / days)}</div></div></div>
      ${(() => {
        const st = L.incomeStats(S, ui.month);
        if (!st) return '';
        const varies = S.settings.incomeMode === 'varies';
        if (!varies && st.spread < 0.2) return '';
        return `<h2>Your income</h2><div class="card"><div>${money(st.min)} – ${money(st.max)} a month, averaging ${money(st.avg)}, over ${st.n} months.</div>
          ${varies ? `<div class="small mute" style="margin-top:6px">Calibr plans on ${money(L.planIncome(S, ui.month))}, based on your lower months, so a good month is a bonus and a slow one is expected.</div>`
            : `<div class="small mute" style="margin-top:6px">That's quite a spread. Planning around your lower months keeps a slow month from breaking the budget.</div><button class="btn block" data-act="setvaries">Plan around my lower months</button>`}</div>`;
      })()}
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
        if (g.buffer) { const plan = L.planIncome(S, L.monthOf(today)); note = plan > 0 ? `Your cushion for lean months: about ${(g.saved / plan).toFixed(1)} months of your plan.` : 'Your cushion for lean months.'; }
        else if (left <= 0) note = '🎉 Goal reached!';
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
        <div class="setrow"><label for="s-mode">My pay is</label><select id="s-mode" data-bind="incomeMode"><option value="steady" ${st.incomeMode === 'steady' ? 'selected' : ''}>Steady</option><option value="varies" ${st.incomeMode === 'varies' ? 'selected' : ''}>Different each time</option></select></div>
        <div class="setrow"><label for="s-income">${st.incomeMode === 'varies' ? 'Starting estimate (a low month)' : 'Monthly income'}</label><input id="s-income" data-bind="income" type="number" inputmode="decimal" step="any" min="0" value="${st.income || ''}" placeholder="0"></div>
        ${st.incomeMode === 'varies' ? `<div class="setrow"><label for="s-plan">Plan on (monthly)</label><input id="s-plan" data-bind="planOverride" type="number" inputmode="decimal" step="any" min="0" value="${st.planOverride || ''}" placeholder="${L.baselineIncome(S, ui.month) || 'auto'}"></div>
        <div class="setrow"><span class="mute small">${st.planOverride ? 'Using your number. Clear it to let Calibr choose.' : L.baselineIncome(S, ui.month) ? `Auto: ${money(L.baselineIncome(S, ui.month))}, the average of your lower recent months. It adjusts as you log income.` : 'Until you have two months of income logged, Calibr uses your starting estimate.'}</span></div>` : ''}
        <div class="setrow"><label for="s-cur">Currency</label><select id="s-cur" data-bind="currency">${L.CURRENCIES.map(([c, n]) => `<option value="${c}" ${c === st.currency ? 'selected' : ''}>${c} · ${n}</option>`).join('')}</select></div>
        <div class="setrow"><label for="s-theme">Appearance</label><select id="s-theme" data-bind="theme">${['auto', 'light', 'dark'].map(t => `<option value="${t}" ${st.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div></div>
      <h2>Smart capture</h2><div class="list">
        <div class="setrow"><label for="s-loc">Use location to suggest categories</label><input id="s-loc" data-bind="locate" type="checkbox" ${st.locate ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--brand)"></div>
        <div class="setrow"><label for="s-quick">Open straight to Add</label><input id="s-quick" data-bind="quickOpen" type="checkbox" ${st.quickOpen ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--brand)"></div>
        <div class="setrow"><label for="s-level">Auto-file when</label><select id="s-level" data-bind="level"><option value="cautious" ${st.level === 'cautious' ? 'selected' : ''}>Very sure</option><option value="balanced" ${st.level === 'balanced' ? 'selected' : ''}>Fairly sure</option><option value="eager" ${st.level === 'eager' ? 'selected' : ''}>Pretty sure</option></select></div>
        <div class="setrow"><span>Check that it's working</span><button class="link" data-act="diag">Test location</button></div>
        <div class="setrow"><span>Places data</span><span class="mute small" style="text-align:right;max-width:60%">${placesStatus()}</span></div>
        ${packBuilderUrl() ? `<div class="setrow"><span>Add places for my area</span><a class="link" href="${packBuilderUrl()}" target="_blank" rel="noopener">Open ›</a></div>` : ''}
        <div class="setrow"><span>Learned so far</span><span class="mute small">${plural(Object.keys(S.learn.merchants).length, 'place')} · ${plural(S.learn.spots.length, 'spot')}</span></div>
        ${S.learn.stats.auto ? `<div class="setrow"><span>Auto-filed so far</span><span class="mute small" style="text-align:right">${S.learn.stats.auto} · ${S.learn.stats.confirmed} confirmed · ${S.learn.stats.fixed} fixed${S.learn.stats.fixed + S.learn.stats.confirmed >= 10 ? ` (${Math.round(L.correctionRate(S.learn.stats) * 100)}% wrong)` : ''}</span></div>` : ''}
        ${L.threshold(st.level, S.learn.stats) > L.THRESHOLDS[st.level] + 0.01 ? '<div class="setrow"><span class="warn small">Extra careful for now, because you have corrected a lot of automatic filings.</span></div>' : ''}
        <div class="setrow"><span>Forget what Calibr learned</span><button class="link over" data-act="forget">Forget…</button></div></div>
      <p class="mute small" style="margin:8px 4px 0">Anything Calibr isn't sure about goes to a review list instead of being filed. "Very sure" sends more there; "Pretty sure" sends fewer. Your location is only read while the add screen is open and never leaves this device. The approximate spot (about 10 m) of each purchase is saved with it so Calibr can learn; "Forget" removes that.</p>
      <h2>Recurring &amp; bills <button class="link" data-act="addrec">+ Add</button></h2>
      ${S.recurring.length ? `<ul class="list">${S.recurring.map(r => `<li><button class="rowbtn" data-act="rec" data-id="${r.id}"><div class="row"><span class="emoji">${r.type === 'income' ? '💵' : catOf(r.cat)?.emoji ?? '🔁'}</span><span class="grow"><div class="title">${esc(r.note)}</div><div class="small mute">${L.FREQUENCIES[r.freq]} · next ${prettyDate(r.next)}</div></span><span class="amt ${r.type === 'income' ? 'inc' : ''}">${r.type === 'income' ? '+' : ''}${money(r.amount)}</span></div></button></li>`).join('')}</ul>`
        : `<div class="card empty" style="margin:0"><p>Rent, subscriptions, paychecks — add them once and Calibr logs them for you.</p></div>`}
      <h2>Your data</h2><div class="list">
        <div class="setrow"><span>Export backup (JSON)</span><button class="link" data-act="exportjson">Export</button></div>
        <div class="setrow"><span>Export spreadsheet (CSV)</span><button class="link" data-act="exportcsv">Export</button></div>
        <div class="setrow"><span>Restore from backup</span><button class="link" data-act="import">Choose file</button></div>
        <div class="setrow"><span>Erase everything</span><button class="link over" data-act="reset">Erase…</button></div></div>
      <input id="file" type="file" accept="application/json,.json" hidden>
      <p class="mute small" style="margin:16px 4px">Calibr ${VERSION}. Your data lives only in this browser on this device — nothing is uploaded. Export a backup now and then, especially before clearing browser data or switching phones.</p>
      ${packs.entry ? '<p class="mute small" style="margin:8px 4px">Places data © Overture Maps Foundation and its sources (CDLA-Permissive-2.0, Apache-2.0, CC0-1.0).</p>' : ''}`;
  },
};

function txRow(t) {
  const c = catOf(t.cat), inc = t.type === 'income';
  const sub = inc ? 'Income' : t.status === 'review' ? '<span class="warn">Needs a category</span>' : esc(c?.name ?? 'Uncategorized');
  return `<li><button class="rowbtn" data-act="tx" data-id="${t.id}"><div class="row"><span class="emoji">${inc ? '💵' : c?.emoji ?? '❔'}</span>
    <span class="grow"><div class="title">${esc(t.note || t.merchant || (t.near ? 'Near ' + t.near.join(' or ') : inc ? 'Income' : c?.name ?? 'Expense'))}</div><div class="small mute">${sub}${t.merchant && t.note ? ' · ' + esc(t.merchant) : ''}${t.auto ? ' · 📍 auto' : ''}${t.rec ? ' · ↻ recurring' : ''}</div></span>
    <span class="amt ${inc ? 'inc' : ''}">${inc ? '+' : ''}${money(t.amount)}</span></div></button></li>`;
}
function txList() {
  const q = ui.q.trim().toLowerCase();
  let txs = L.monthTx(S, ui.month).filter(t =>
    (ui.type === 'all' || t.type === ui.type || (ui.type === 'review' && t.status === 'review') || (ui.type === 'auto' && t.auto)) &&
    (ui.cat === 'all' || (ui.cat === 'none' ? t.type === 'expense' && !catOf(t.cat) : t.cat === ui.cat)) &&
    (!q || [t.note, t.merchant, ...(t.near || []), catOf(t.cat)?.name].some(x => x && x.toLowerCase().includes(q))));
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
  document.querySelector('#nav [data-tab=budget]').dataset.badge = L.reviewList(S).length || '';
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
  pick: el => { cap.picked = cap.picked === el.dataset.id ? null : el.dataset.id; const r = document.querySelector(`#sheet input[name=cat][value="${cap.picked || ''}"]`); if (r) r.checked = true; refreshCapture(); },
  enableloc: () => { S.settings.locate = true; save(); startLocating(refreshCapture); refreshCapture(); },
  review: () => reviewSheet(),
  resolve: el => {
    const t = S.transactions.find(x => x.id === el.dataset.id), c = catOf(el.dataset.cat);
    if (t && c) reviewChange(`Filed ${money(t.amount)} under ${c.name}`, () => fileTx(t, c.id, false));
  },
  rvdel: el => { const t = S.transactions.find(x => x.id === el.dataset.id); if (t) reviewChange('Deleted', () => { S.transactions = S.transactions.filter(x => x.id !== t.id); }); },
  rvother: el => { const t = S.transactions.find(x => x.id === el.dataset.id); if (t) { closeSheet(); txSheet(t); } },
  split: el => { const t = S.transactions.find(x => x.id === el.dataset.id); if (t) { closeSheet(); splitSheet(t); } },
  addsplit: () => $('splitrows').insertAdjacentHTML('beforeend', splitRow(S.categories[0].id)),
  autoreview: () => autoSheet(),
  confirm: el => { const t = S.transactions.find(x => x.id === el.dataset.id); if (t) autoChange('Confirmed', () => { delete t.auto; S.learn.stats.confirmed++; }); },
  confirmall: () => { const list = L.autoUnconfirmed(S, L.todayStr()).slice(0, 12); autoChange(`Confirmed ${list.length}`, () => list.forEach(t => { delete t.auto; S.learn.stats.confirmed++; })); },
  diag: () => diagSheet(),
  tobuffer: () => bufferSheet(),
  usebuffer: () => useBuffer(),
  lean: () => leanSheet(),
  setavail: el => { const i = document.querySelector('#sheet [name=avail]'); i.value = el.dataset.v; i.dispatchEvent(new Event('input', { bubbles: true })); },
  monthlimit: el => { closeSheet(); monthLimitSheet(el.dataset.id); },
  setvaries: () => { S.settings.incomeMode = 'varies'; save(); render(); toast('Now planning around your lower months'); },
  rvundo2: () => { const u = rvUndo; rvUndo = null; u?.(); autoSheet('Undone'); },
  rvundo: () => { const u = rvUndo; rvUndo = null; u?.(); reviewSheet('Undone'); },
  forget: () => {
    if (!confirm('Forget every place Calibr has learned, and remove the approximate location saved with each purchase? Your purchases and their categories are kept.')) return;
    change('Learning reset', () => { S.learn = { merchants: {}, spots: [], stats: S.learn.stats }; S.transactions.forEach(t => { delete t.loc; delete t.mkey; }); });
  },
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
  else if (bind === 'incomeMode') { S.settings.incomeMode = t.value; save(); render(); }
  else if (bind === 'planOverride') { S.settings.planOverride = Math.max(0, L.round2(parseFloat(t.value) || 0)); save(); render(); }
  else if (bind === 'currency') { S.settings.currency = t.value; save(); render(); }
  else if (bind === 'locate') { S.settings.locate = t.checked; save(); }
  else if (bind === 'quickOpen') { S.settings.quickOpen = t.checked; save(); }
  else if (bind === 'level') { S.settings.level = t.value; save(); }
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
else if (S.settings.quickOpen || new URLSearchParams(location.search).has('add')) txSheet(null);
if (location.search) history.replaceState(null, '', location.pathname);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
