
// public/dashboard.js — maakt een nuttig dashboard op basis van transactielogregels
// Datamodel (per transactie) zoals aangeleverd:
// {
//   _id, username, userDisplayName, drinkId, drinkName,
//   price, beforeStreepjes, afterStreepjes, ip,
//   createdAt, updatedAt
// }

function getToken(){ return localStorage.getItem('token'); }
function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) { window.location.href = '/login.html'; throw new Error('Niet ingelogd'); }
  return fetch(url, { ...options, headers: { 'Authorization': 'Bearer '+token, ...(options.headers||{}) } })
    .then(async (res) => {
      if (res.status === 401) { localStorage.removeItem('token'); window.location.href = '/login.html'; throw new Error('Niet geautoriseerd'); }
      return res;
    });
}

// Navigatie
function toAfstreep() { window.location.href = '/app.html'; }
function toBeheer() { window.location.href = '/barmeester.html'; }

document.getElementById('toAfstreepBtn')?.addEventListener('click', toAfstreep);
document.getElementById('toAdminBtn')?.addEventListener('click', toBeheer);

// UI refs
const rangeSelect = document.getElementById('rangeSelect');
const refreshBtn = document.getElementById('refreshBtn');
const rangeHint = document.getElementById('rangeHint');
const histTitle = document.getElementById('histTitle');
const kpiGrid = document.getElementById('kpiGrid');
const topDrinksList = document.getElementById('topDrinksList');
const topUsersList = document.getElementById('topUsersList');
const histogram = document.getElementById('histogram');
const recentList = document.getElementById('recentList');
const lowStockList = document.getElementById('lowStockList');
const lowStockEmpty = document.getElementById('lowStockEmpty');

async function ensureBarmeester() {
  try {
    const res = await authFetch('/api/me');
    const me = await res.json();
    if (!me.isBarmeester) { window.location.href = '/app.html'; return; }
  } catch { window.location.href = '/app.html'; }
}

// ---- Data ophalen ----
// We proberen een paar standaard endpoints (pas ze indien nodig aan je backend aan)
async function fetchFirstAvailable(urls) {
  for (const u of urls) {
    try {
      const res = await authFetch(u);
      if (res.ok) return res.json();
    } catch (_) { /* try next */ }
  }
  throw new Error('Geen transactie-endpoint gevonden');
}

function rangeToBounds(range) {
  const now = new Date();
  const end = now; // tot nu
  const start = new Date(now);
  if (range === 'today') { start.setHours(0,0,0,0); }
  else if (range === '7d') { start.setDate(start.getDate() - 6); start.setHours(0,0,0,0); }
  else if (range === '30d') { start.setDate(start.getDate() - 29); start.setHours(0,0,0,0); }
  return { start, end };
}

async function loadTransactions(range) {
  const { start, end } = rangeToBounds(range);
  const qs = `?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
  // Voorkeursvolgorde — pas aan als jouw backend anders heet
  const urls = [
    `/api/dashboard/transactions${qs}`,
    `/api/transactions${qs}`,
    `/api/logs${qs}`,
  ];
  const arr = await fetchFirstAvailable(urls);
  return Array.isArray(arr) ? arr : [];
}

// ---- Aggregatie helpers ----
function deltaFrom(tx) {
  const b = Number(tx.beforeStreepjes);
  const a = Number(tx.afterStreepjes);
  if (Number.isFinite(b) && Number.isFinite(a)) return a - b; // positief = toekenning, negatief = consumptie
  return -1; // val terug op 1 consumptie
}
function qtyFrom(tx) {
  const d = deltaFrom(tx);
  return Math.abs(d || 1);
}

function groupCountBy(arr, keyFn, qtyFn = () => 1) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x) ?? '—';
    const add = qtyFn(x);
    m.set(k, (m.get(k) || 0) + add);
  }
  return m;
}

function formatEuro(n) {
  return new Intl.NumberFormat('nl-NL', { style:'currency', currency:'EUR' }).format(n);
}

function kpiTile(title, value, sub) {
  const btn = document.createElement('button');
  btn.className = 'drink-btn';
  btn.style.minHeight = '72px';
  btn.innerHTML = `<div style="display:flex; flex-direction:column; gap:4px;">
    <div style="font-weight:700; font-size:1.1rem;">${value}</div>
    <div class="subtitle" style="font-size:.9rem;">${title}${sub ? ` · ${sub}` : ''}</div>
  </div>`;
  btn.disabled = true;
  return btn;
}

function renderList(ul, pairs, emptyText='Nog geen data') {
  ul.innerHTML = '';
  if (pairs.length === 0) { ul.innerHTML = `<li class="empty">${emptyText}</li>`; return; }
  for (const [label, value] of pairs) {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    ul.appendChild(li);
  }
}

function renderHistogram(listEl, dataPairs) {
  listEl.innerHTML = '';
  const max = Math.max(1, ...dataPairs.map(([,v]) => v));
  for (const [label, val] of dataPairs) {
    const li = document.createElement('li');
    li.className = 'chart-item';
    li.innerHTML = `
      <span class="chart-label">${label}</span>
      <div class="chart-bar"><span style="width:${(val/max*100).toFixed(1)}%"></span></div>
      <span class="chart-value">${val}</span>
    `;
    listEl.appendChild(li);
  }
}

function dateKey(d) {
  const yy = d.getFullYear();
  const mm = (d.getMonth()+1).toString().padStart(2,'0');
  const dd = d.getDate().toString().padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}

// ---- Low stock ----
async function loadLowStock() {
  try {
    const res = await authFetch('/api/barmeester/drinks?active=true');
    const drinks = await res.json();
    const LOW = 5;
    const low = (Array.isArray(drinks)?drinks:[]).filter(d => (d.stock ?? 0) <= LOW);
    lowStockList.innerHTML = '';
    if (low.length === 0) { lowStockEmpty.style.display = 'block'; return; }
    lowStockEmpty.style.display = 'none';
    for (const d of low) {
      const li = document.createElement('li'); li.className='item';
      li.innerHTML = `<span>${d.name}</span><span>${d.stock ?? 0} stuks</span>`;
      lowStockList.appendChild(li);
    }
  } catch { /* negeer */ }
}

function rangeText(v) {
  switch (v) {
    case 'today': return 'Vandaag';
    case '7d': return 'Afgelopen 7 dagen';
    case '30d': return 'Afgelopen 30 dagen';
    default: return v;
  }
}

async function refresh() {
  const r = rangeSelect.value;
  rangeHint.textContent = `Bereik: ${rangeText(r)}`;

  const tx = await loadTransactions(r);

  // splitsing consumpties (delta negatief) vs toekenningen (delta positief)
  const cons = tx.filter(t => deltaFrom(t) < 0);
  const grants = tx.filter(t => deltaFrom(t) > 0);

  const consQty = cons.reduce((s,t) => s + qtyFrom(t), 0);
  const grantQty = grants.reduce((s,t) => s + qtyFrom(t), 0);
  const netQty = consQty - grantQty;

  const uniqUsers = new Set(tx.map(t => t.username)).size;

  // Omzet (alleen tonen als er non-zero prijzen zijn). Als price is prijs per item, vermenigvuldigen met qty.
  const prices = tx.map(t => Number(t.price)).filter(Number.isFinite);
  const hasPrice = prices.some(p => p > 0);
  const revenue = hasPrice ? tx.reduce((s,t) => s + (Number(t.price)||0) * qtyFrom(t), 0) : null;

  // KPI tiles
  kpiGrid.innerHTML = '';
  kpiGrid.appendChild(kpiTile('Consumpties', consQty));
  kpiGrid.appendChild(kpiTile('Toekenningen', grantQty));
  kpiGrid.appendChild(kpiTile('Netto streepjes', netQty));
  kpiGrid.appendChild(kpiTile('Unieke gebruikers', uniqUsers));
  if (hasPrice) kpiGrid.appendChild(kpiTile('Omzet', formatEuro(revenue)));

  // Top 5 drankjes (alleen consumpties)
  const byDrink = groupCountBy(cons, t => t.drinkName || 'Onbekend', qtyFrom);
  const topDrinks = [...byDrink.entries()].sort((a,b) => b[1]-a[1]).slice(0,5);
  renderList(topDrinksList, topDrinks.map(([n,v]) => [n, v] ), 'Geen consumpties');

  // Top gebruikers
  const byUser = groupCountBy(cons, t => t.userDisplayName || t.username || '—', qtyFrom);
  const topUsers = [...byUser.entries()].sort((a,b) => b[1]-a[1]).slice(0,5);
  renderList(topUsersList, topUsers.map(([n,v]) => [n, v] ), 'Geen consumpties');

  // Histogram (per uur of per dag)
  if (r === 'today') {
    histTitle.textContent = 'Consumpties per uur';
    const byHour = new Array(24).fill(0);
    for (const t of cons) {
      const d = new Date(t.createdAt);
      const h = d.getHours();
      byHour[h] += qtyFrom(t);
    }
    const pairs = byHour.map((v,i) => [String(i).padStart(2,'0')+':00', v]);
    renderHistogram(histogram, pairs);
  } else {
    histTitle.textContent = 'Consumpties per dag';
    const map = new Map();
    for (const t of cons) {
      const k = dateKey(new Date(t.createdAt));
      map.set(k, (map.get(k)||0) + qtyFrom(t));
    }
    const pairs = [...map.entries()].sort((a,b) => a[0].localeCompare(b[0]));
    renderHistogram(histogram, pairs);
  }

  // Recentste transacties (laatste 10)
  recentList.innerHTML = '';
  const recent = [...tx].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,10);
  if (recent.length === 0) {
    recentList.innerHTML = '<li class="empty">Nog geen transacties</li>';
  } else {
    for (const t of recent) {
      const d = new Date(t.createdAt);
      const delta = deltaFrom(t);
      const sign = delta < 0 ? '−' : '+';
      const qty = qtyFrom(t);
      const who = t.userDisplayName || t.username || '—';
      const what = t.drinkName || '—';
      const li = document.createElement('li'); li.className='item';
      li.innerHTML = `<span>${who} · ${what}</span><span>${sign}${qty} · ${d.toLocaleString('nl-NL')}</span>`;
      recentList.appendChild(li);
    }
  }

  // Voorraadalerts
  await loadLowStock();
}

function rangeTextUI(v) {
  switch (v) {
    case 'today': return 'Vandaag';
    case '7d': return 'Afgelopen 7 dagen';
    case '30d': return 'Afgelopen 30 dagen';
    default: return v;
  }
}

// Init
(async function init(){
  await ensureBarmeester();
  rangeSelect.value = 'today';
  await refresh();
})();

refreshBtn?.addEventListener('click', refresh);
rangeSelect?.addEventListener('change', refresh);
