// ===== Helpers =====
function getToken(){ return localStorage.getItem('token'); }
function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) { window.location.href = '/login.html'; throw new Error('Niet ingelogd'); }
  return fetch(url, { ...options, headers: { 'Authorization': 'Bearer ' + token, ...(options.headers ?? {}) } })
    .then(async (res) => {
      if (res.status === 401) { localStorage.removeItem('token'); window.location.href = '/login.html'; throw new Error('Niet geautoriseerd'); }
      return res;
    });
}
// ✅ Gebruik een geldige identifier i.p.v. het euro-teken
const formatEuro = (n) => '€ ' + (Number(n)||0).toFixed(2).replace('.', ',');

// ===== Overlay =====
const overlay = document.getElementById('overlay');
const modalContent = document.getElementById('modalContent');
const closeOverlayBtn = document.getElementById('closeOverlay');
function showOverlay(title='Financiën'){ document.getElementById('modalTitle').textContent = title; overlay.style.display='flex'; overlay.classList.add('active'); overlay.setAttribute('aria-hidden','false'); }
function hideOverlay(){ overlay.classList.remove('active'); overlay.setAttribute('aria-hidden','true'); overlay.style.display='none'; modalContent.innerHTML=''; }

closeOverlayBtn?.addEventListener('click', hideOverlay);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideOverlay(); });
overlay?.addEventListener('click', (e) => { if (e.target === overlay) hideOverlay(); });

// ===== Guards =====
async function ensureBarmeester() {
  const res = await authFetch('/api/me');
  const me = await res.json();
  if (!me.isBarmeester) { window.location.href = '/app.html'; return; }
}

// ===== UI refs =====
const cashBalance = document.getElementById('cashBalance');
const cashIn = document.getElementById('cashIn');
const cashOut = document.getElementById('cashOut');
const cashOpening = document.getElementById('cashOpening');
const txList = document.getElementById('txList');
const btnNewExpense = document.getElementById('btnNewExpense');
const btnPricing = document.getElementById('btnPricing');
const btnRefresh = document.getElementById('btnRefresh');

// ===== Data loaders =====
async function loadSummary(){
  const res = await authFetch('/api/finance/summary');
  const s = await res.json();
  cashBalance.textContent = formatEuro(s.balance);
  cashIn.textContent = formatEuro(s.inflow);
  cashOut.textContent = formatEuro(s.outflow);
  cashOpening.textContent = formatEuro(s.openingBalance);
  return s;
}

async function loadTransactions(){
  txList.innerHTML = '<p class="subtitle">Laden…</p>';
  const res = await authFetch('/api/finance/transactions?limit=100');
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    txList.innerHTML = '<p class="subtitle">Nog geen transacties</p>'; return;
  }
  const list = document.createElement('div'); list.className = 'admin-list';
  data.forEach(t => {
    const item = document.createElement('div'); item.className = 'admin-item';
    const head = document.createElement('div'); head.className = 'admin-item-head';
    const left = document.createElement('div'); left.className = 'admin-name';
    left.textContent = `${t.type === 'OUTFLOW' ? 'Uitgave' : 'Inleg'} • ${new Date(t.createdAt).toLocaleString('nl-NL')}`;
    const right = document.createElement('div'); right.className = 'admin-stock';
    right.textContent = (t.type === 'OUTFLOW' ? '-' : '+') + formatEuro(t.amount);
    head.appendChild(left); head.appendChild(right);
    const body = document.createElement('div'); body.className = 'admin-item-body';
    body.innerHTML = `<div class="subtitle">Door: ${t.by || 'onbekend'}</div><div>${t.note || ''}</div>`;
    item.appendChild(head); item.appendChild(body);
    head.addEventListener('click', () => item.classList.toggle('active'));
    list.appendChild(item);
  });
  txList.innerHTML = '';
  txList.appendChild(list);
}

// ===== Modals =====
function openExpenseModal(){
  showOverlay('Transactie registreren');
  modalContent.innerHTML = '';

  const list = document.createElement('div'); list.className = 'list';

  const rowType = document.createElement('div'); rowType.className = 'row';
  const metaType = document.createElement('div'); metaType.className = 'meta';
  metaType.innerHTML = '<div class="title">Type</div><div class="sub">Kies uitgave of inleg</div>';
  const actionsType = document.createElement('div'); actionsType.className = 'actions';
  const sel = document.createElement('select'); sel.className = 'input-inline';
  sel.innerHTML = '<option value="OUTFLOW">Uitgave (inkoop)</option><option value="INFLOW">Inleg (storting)</option>';
  actionsType.appendChild(sel);
  rowType.appendChild(metaType); rowType.appendChild(actionsType);

  const rowAmt = document.createElement('div'); rowAmt.className = 'row';
  const metaAmt = document.createElement('div'); metaAmt.className = 'meta';
  metaAmt.innerHTML = '<div class="title">Bedrag</div><div class="sub">Gebruik punt of komma</div>';
  const actionsAmt = document.createElement('div'); actionsAmt.className = 'actions';
  const inpAmt = document.createElement('input'); inpAmt.className = 'input-inline'; inpAmt.placeholder = 'Bijv. 25,00'; inpAmt.inputMode = 'decimal';
  actionsAmt.appendChild(inpAmt);
  rowAmt.appendChild(metaAmt); rowAmt.appendChild(actionsAmt);

  const rowNote = document.createElement('div'); rowNote.className = 'row';
  const metaNote = document.createElement('div'); metaNote.className = 'meta';
  metaNote.innerHTML = '<div class="title">Omschrijving</div><div class="sub">Waar is dit voor?</div>';
  const actionsNote = document.createElement('div'); actionsNote.className = 'actions';
  const inpNote = document.createElement('input'); inpNote.className = 'input-inline'; inpNote.placeholder = 'Bijv. Inkoop frisdrank';
  actionsNote.appendChild(inpNote);
  rowNote.appendChild(metaNote); rowNote.appendChild(actionsNote);

  const bar = document.createElement('div'); bar.className = 'modal-actions';
  const cancel = document.createElement('button'); cancel.className = 'danger'; cancel.textContent = 'Annuleren';
  const save = document.createElement('button'); save.textContent = 'Opslaan';
  bar.appendChild(cancel); bar.appendChild(save);

  list.appendChild(rowType); list.appendChild(rowAmt); list.appendChild(rowNote);
  modalContent.appendChild(list); modalContent.appendChild(bar);

  cancel.addEventListener('click', () => hideOverlay());
  save.addEventListener('click', async () => {
    const amount = Number(String(inpAmt.value).replace(',', '.'));
    if (!isFinite(amount) || amount <= 0) { alert('Voer een geldig bedrag in'); return; }
    save.disabled = true; cancel.disabled = true; save.textContent = 'Opslaan…';
    try {
      const r = await authFetch('/api/finance/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: sel.value, amount, note: inpNote.value || '' })
      });
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || 'Mislukt'); }
      hideOverlay(); await Promise.all([loadSummary(), loadTransactions()]);
    } catch (e) {
      alert(e.message || 'Kon transactie niet opslaan'); save.disabled = false; cancel.disabled = false; save.textContent = 'Opslaan';
    }
  });
}

async function openPricingModal(){
  showOverlay('Prijzen & streepjes per drankje');
  modalContent.innerHTML = '<p class="subtitle">Laden…</p>';

  // settings + drinks
  const [sRes, dRes] = await Promise.all([
    authFetch('/api/barmeester/settings'),
    authFetch('/api/barmeester/drinks')
  ]);
  const settings = await sRes.json();
  const drinks = await dRes.json();

  const pricePerStrip = (Number(settings.pricePerCard)>0 && Number(settings.stripsPerCard)>0)
    ? Number(settings.pricePerCard)/Number(settings.stripsPerCard) : 0;

  const list = document.createElement('div'); list.className = 'admin-list'; modalContent.innerHTML = '';
  drinks.forEach(d => {
    const item = document.createElement('div'); item.className = 'admin-item';
    const head = document.createElement('div'); head.className = 'admin-item-head';
    const left = document.createElement('div'); left.className = 'admin-name'; left.textContent = d.name;
    const right = document.createElement('div'); right.className = 'admin-stock';
    right.textContent = d.active ? 'Actief' : 'Verborgen';
    head.appendChild(left); head.appendChild(right);

    const body = document.createElement('div'); body.className = 'admin-item-body';

    // Inputs
    const row = document.createElement('div'); row.className = 'row';
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = '<div class="title">Instellingen</div><div class="sub">Streepjes per drankje & inkoopprijs</div>';
    const actions = document.createElement('div'); actions.className = 'actions';

    const inpStrips = document.createElement('input'); inpStrips.type='number'; inpStrips.min='1'; inpStrips.step='1';
    inpStrips.className='input-inline'; inpStrips.value = String(d.stripsCost ?? 1);

    const inpPurchase = document.createElement('input'); inpPurchase.type='text'; inpPurchase.inputMode='decimal';
    inpPurchase.className='input-inline'; inpPurchase.placeholder='Inkoopprijs'; inpPurchase.value = (Number(d.purchasePrice)||0).toString().replace('.',',');

    const btnSave = document.createElement('button'); btnSave.textContent = 'Opslaan';

    actions.appendChild(inpStrips); actions.appendChild(inpPurchase); actions.appendChild(btnSave);
    row.appendChild(meta); row.appendChild(actions);

    // Computed
    const row2 = document.createElement('div'); row2.className = 'row';
    const meta2 = document.createElement('div'); meta2.className = 'meta';
    meta2.innerHTML = '<div class="title">Berekening</div><div class="sub">Verkoopprijs, winst & marge</div>';
    const actions2 = document.createElement('div'); actions2.className='actions';
    const calcBox = document.createElement('div'); calcBox.className='toggle'; calcBox.textContent='—';
    actions2.appendChild(calcBox);
    row2.appendChild(meta2); row2.appendChild(actions2);

    function recalc(){
      const strips = Math.max(1, Math.floor(Number(inpStrips.value)));
      const purchase = Math.max(0, Number(String(inpPurchase.value).replace(',', '.')));
      const sale = strips * pricePerStrip;
      const profit = sale - purchase;
      const marginPct = purchase > 0 ? (profit / purchase) * 100 : null;
      calcBox.textContent = `Inkoop: ${formatEuro(purchase)} • Verkoop: ${formatEuro(sale)} • Winst: ${formatEuro(profit)}${marginPct!==null ? ` (${marginPct.toFixed(0)}%)` : ''}`;
    }
    recalc();
    inpStrips.addEventListener('input', recalc);
    inpPurchase.addEventListener('input', recalc);

    btnSave.addEventListener('click', async () => {
      const payload = {
        stripsCost: Math.max(1, Math.floor(Number(inpStrips.value))),
        purchasePrice: Math.max(0, Number(String(inpPurchase.value).replace(',', '.')))
      };
      btnSave.disabled = true; btnSave.textContent = 'Opslaan…';
      try {
        const r = await authFetch(`/api/barmeester/drinks/${encodeURIComponent(d._id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || 'Opslaan mislukt'); }
        alert('Opgeslagen');
      } catch (e) {
        alert(e.message || 'Opslaan mislukt');
      }
      btnSave.disabled = false; btnSave.textContent = 'Opslaan';
    });

    body.appendChild(row); body.appendChild(row2);
    item.appendChild(head); item.appendChild(body);
    head.addEventListener('click', () => item.classList.toggle('active'));
    list.appendChild(item);
  });

  modalContent.appendChild(list);
}

// ===== Events & init =====
btnNewExpense?.addEventListener('click', openExpenseModal);
btnPricing?.addEventListener('click', openPricingModal);
btnRefresh?.addEventListener('click', async () => { await Promise.all([loadSummary(), loadTransactions()]); });

document.addEventListener('DOMContentLoaded', async () => {
  await ensureBarmeester();
  await Promise.all([loadSummary(), loadTransactions()]);
});