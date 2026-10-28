'use strict';
const KEY = 'calibr.v1';
const $ = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = n => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
const monthKey = d => d.toISOString().slice(0, 7);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

const defaults = () => ({
  categories: [
    { id: uid(), emoji: '🛒', name: 'Groceries', limit: 400 },
    { id: uid(), emoji: '🏠', name: 'Housing', limit: 1200 },
    { id: uid(), emoji: '🚗', name: 'Transport', limit: 150 },
    { id: uid(), emoji: '🍽️', name: 'Eating out', limit: 120 },
    { id: uid(), emoji: '🎉', name: 'Fun', limit: 100 },
  ],
  expenses: [],
});

let state;
try { state = JSON.parse(localStorage.getItem(KEY)) || defaults(); } catch { state = defaults(); }
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

let view = new Date(); view.setDate(1); view.setHours(12);
const viewKey = () => monthKey(view);

function level(pct) { return pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''; }

function render() {
  $('month').textContent = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const exp = state.expenses.filter(e => e.date.startsWith(viewKey()));
  const spentBy = id => exp.filter(e => e.cat === id).reduce((s, e) => s + e.amount, 0);
  const budget = state.categories.reduce((s, c) => s + c.limit, 0);
  const spent = exp.reduce((s, e) => s + e.amount, 0);
  const left = budget - spent, pct = budget ? spent / budget * 100 : 0;

  $('left').textContent = fmt(left);
  $('left').classList.toggle('over', left < 0);
  $('spent').textContent = `${fmt(spent)} spent`;
  $('budget').textContent = `of ${fmt(budget)}`;
  const tb = $('total-bar'); tb.style.width = Math.min(pct, 100) + '%'; tb.className = level(pct);

  $('cats').innerHTML = state.categories.map(c => {
    const s = spentBy(c.id), p = c.limit ? s / c.limit * 100 : 0, r = c.limit - s;
    return `<li><div class="row"><span>${c.emoji} ${esc(c.name)}</span>
      <span class="${r < 0 ? 'mute' : ''}"><b>${fmt(Math.abs(r))}</b> <span class="mute">${r < 0 ? 'over' : 'left'}</span></span></div>
      <div class="bar"><div class="${level(p)}" style="width:${Math.min(p, 100)}%"></div></div></li>`;
  }).join('') || '<li class="empty">No categories yet</li>';

  const catOf = id => state.categories.find(c => c.id === id);
  $('txns').innerHTML = exp.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(e => {
    const c = catOf(e.cat);
    return `<li><div class="row"><span>${c ? c.emoji : '❔'} ${esc(e.note || (c ? c.name : 'Expense'))}
      <div class="mute">${e.date}</div></span>
      <span>${fmt(e.amount)} <button class="del" data-id="${e.id}" aria-label="Delete">✕</button></span></div></li>`;
  }).join('') || '<li class="empty">No expenses this month</li>';
}

const esc = s => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Month navigation
const shift = n => { view.setMonth(view.getMonth() + n); render(); };
$('prev').onclick = () => shift(-1);
$('next').onclick = () => shift(1);

// Add expense
$('add').onclick = () => {
  $('e-cat').innerHTML = state.categories.map(c => `<option value="${c.id}">${c.emoji} ${esc(c.name)}</option>`).join('');
  $('expense-form').reset();
  $('e-date').value = today();
  $('expense-dialog').showModal();
  $('e-amount').focus();
};
$('expense-form').addEventListener('submit', ev => {
  if (ev.submitter?.value !== 'save') return;
  const amount = parseFloat($('e-amount').value);
  if (!(amount > 0) || !$('e-cat').value) return;
  state.expenses.push({ id: uid(), amount, cat: $('e-cat').value, note: $('e-note').value.trim(), date: $('e-date').value });
  save(); render();
});
$('txns').onclick = ev => {
  const id = ev.target.dataset?.id;
  if (id && confirm('Delete this expense?')) { state.expenses = state.expenses.filter(e => e.id !== id); save(); render(); }
};

// Edit categories
let draft = [];
function renderRows() {
  $('cat-rows').innerHTML = draft.map((c, i) => `<div class="cat-row">
    <input data-i="${i}" data-f="emoji" value="${c.emoji}" maxlength="2" aria-label="Emoji">
    <input data-i="${i}" data-f="name" value="${esc(c.name)}" aria-label="Name">
    <input data-i="${i}" data-f="limit" type="number" min="0" step="1" value="${c.limit}" aria-label="Limit">
    <button type="button" class="del" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('');
}
$('edit-cats').onclick = () => { draft = state.categories.map(c => ({ ...c })); renderRows(); $('cats-dialog').showModal(); };
$('cat-rows').oninput = ev => {
  const { i, f } = ev.target.dataset; if (i == null) return;
  draft[i][f] = f === 'limit' ? Math.max(0, parseFloat(ev.target.value) || 0) : ev.target.value;
};
$('cat-rows').onclick = ev => { const i = ev.target.dataset.rm; if (i != null) { draft.splice(i, 1); renderRows(); } };
$('add-cat').onclick = () => { draft.push({ id: uid(), emoji: '💡', name: 'New', limit: 0 }); renderRows(); };
$('cats-form').addEventListener('submit', ev => {
  if (ev.submitter?.value !== 'save') return;
  state.categories = draft.filter(c => c.name.trim());
  save(); render();
});
$('export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = 'calibr-export.json'; a.click();
};

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
