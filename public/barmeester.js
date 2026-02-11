// public/barmeester.js — Voorraadbeheer in “kaartjes” layout met correcte click-handling (mobiel)

// ===== Helpers =====
function getToken(){ return localStorage.getItem('token'); }
function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return Promise.reject(new Error('Niet ingelogd')); }
  return fetch(url, { ...options, headers: { 'Authorization': 'Bearer ' + token, ...(options.headers || {}) } })
    .then(async (res) => {
      if (res.status === 401) { localStorage.removeItem('token'); window.location.href = '/login.html'; throw new Error('Niet geautoriseerd'); }
      return res;
    });
}

// ===== UI refs =====
const grantBtn        = document.getElementById('grantBtn');
const stockBtn        = document.getElementById('stockBtn');
const dashboardBtn    = document.getElementById('dashboardBtn');

const overlay         = document.getElementById('overlay');
const adminContent    = document.getElementById('adminContent');
const closeOverlayBtn = document.getElementById('closeOverlay');

let scrollLockPrevHtmlOverflow = '';
let scrollLockPrevBodyOverflow = '';
const CLOSE_ANIM_MS = 200;

// ===== Scroll lock =====
function lockScroll() {
  const html = document.documentElement, body = document.body;
  scrollLockPrevHtmlOverflow = html.style.overflow;
  scrollLockPrevBodyOverflow = body.style.overflow;
  html.style.overflow = 'hidden'; body.style.overflow = 'hidden';
}
function unlockScroll() {
  const html = document.documentElement, body = document.body;
  html.style.overflow = scrollLockPrevHtmlOverflow || '';
  body.style.overflow = scrollLockPrevBodyOverflow || '';
}

// ===== Popup helpers =====
function showOverlay(title='Barmeester') {
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.textContent = title;
  overlay.classList.remove('closing');
  overlay.style.display = 'flex';
  overlay.offsetHeight; // reflow
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  lockScroll();
  try { overlay.querySelector('.modal')?.focus?.(); } catch {}
}
function hideOverlay() {
  overlay.classList.remove('active');
  overlay.classList.add('closing');
  overlay.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    overlay.classList.remove('closing');
    overlay.style.display = 'none';
    adminContent.innerHTML = '';
    unlockScroll();
  }, CLOSE_ANIM_MS);
}

// ===== Barmeester check + toggle naar afstreep =====
async function ensureBarmeester() {
  try {
    const res = await authFetch('/api/me');
    const me = await res.json();
    if (!me.isBarmeester) { window.location.href = '/app.html'; return; }
    injectBackToAfstreep();
  } catch {
    window.location.href = '/app.html';
  }
}
function injectBackToAfstreep() {
  if (document.getElementById('toAfstreepBtn')) return;
  const header = document.querySelector('header'); if (!header) return;
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px'; wrap.style.display = 'flex'; wrap.style.justifyContent = 'center';
  const btn = document.createElement('button');
  btn.id = 'toAfstreepBtn'; btn.textContent = 'Naar afstreepscherm';
  btn.addEventListener('click', () => window.location.href = '/app.html');
  wrap.appendChild(btn); header.appendChild(wrap);
}

// ====== 1) Barkaart toekennen (+7) ======
async function renderGrant() {
  adminContent.innerHTML = '<p class="subtitle">Gebruikers laden…</p>';
  try {
    const res = await authFetch('/api/barmeester/users');
    const users = await res.json();
    if (!Array.isArray(users) || users.length === 0) { adminContent.innerHTML = '<p class="subtitle">Geen gebruikers gevonden</p>'; return; }

    const list = document.createElement('div'); list.className = 'admin-list';
    users.forEach(u => {
      const item = document.createElement('div'); item.className = 'admin-item';

      const head = document.createElement('div'); head.className = 'admin-item-head';
      const left = document.createElement('div'); left.className = 'admin-name'; left.textContent = u.displayName || u.username;
      const right = document.createElement('div'); right.className = 'admin-stock'; right.textContent = `streepjes: ${u.streepjes}`;
      head.appendChild(left); head.appendChild(right);

      const body = document.createElement('div'); body.className = 'admin-item-body';
      const grant = document.createElement('button'); grant.className = 'btn btn-green'; grant.textContent = '+7 toekennen';
      grant.addEventListener('click', async (e) => {
        e.stopPropagation();
        grant.disabled = true; grant.textContent = 'Toekennen…';
        try {
          const r = await authFetch(`/api/barmeester/users/${encodeURIComponent(u.username)}/grant-barkaart`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 7 })
          });
          const data = await r.json().catch(()=> ({}));
          if (!r.ok) { alert(data.error || 'Mislukt'); grant.disabled = false; grant.textContent = '+7 toekennen'; return; }
          alert(`${u.displayName || u.username} heeft nu ${data.streepjes} streepjes.`);
          hideOverlay();
        } catch {
          alert('Kon niet toekennen.'); grant.disabled = false; grant.textContent = '+7 toekennen';
        }
      });

      body.appendChild(grant);
      head.addEventListener('click', () => item.classList.toggle('active'));

      item.appendChild(head);
      item.appendChild(body);
      list.appendChild(item);
    });

    adminContent.innerHTML = '';
    adminContent.appendChild(list);
  } catch {
    adminContent.innerHTML = '<p class="subtitle" style="color:#fca5a5">Kon gebruikers niet laden</p>';
  }
}
async function openGrant() { showOverlay('Barkaart toekennen (+7)'); renderGrant(); }

// ====== 2) Voorraadbeheer (kaart‑layout) ======
function iconVisible(active){ return active ? '👁️' : '🚫'; }

function makeDrinkItem(d) {
  const item = document.createElement('div'); item.className = 'admin-item';

  const head = document.createElement('div'); head.className = 'admin-item-head';
  const left = document.createElement('div'); left.className = 'admin-name';
  left.innerHTML = `${d.name} <span class="${d.active ? 'admin-eye' : 'admin-hide'}">${iconVisible(d.active)}</span>`;
  const right = document.createElement('div'); right.className = 'admin-stock';
  right.textContent = `${(typeof d.stock === 'number' ? d.stock : 0)} stuks`;
  head.appendChild(left); head.appendChild(right);

  const body = document.createElement('div'); body.className = 'admin-item-body';

  const input = document.createElement('input');
  input.className = 'admin-input';
  input.type = 'number'; input.inputMode = 'numeric'; input.pattern = '[0-9]*'; input.min = '0';
  input.value = String(typeof d.stock === 'number' ? d.stock : 0);
  input.placeholder = 'Voorraad';
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('input', (e) => e.stopPropagation());

  const actions = document.createElement('div'); actions.className = 'admin-actions';

  const btnUpdate = document.createElement('button'); btnUpdate.className = 'btn btn-blue'; btnUpdate.textContent = 'UPDATE';
  const btnToggle = document.createElement('button'); btnToggle.className = 'btn btn-gray'; btnToggle.textContent = d.active ? 'VERBERG' : 'TOON';
  const btnDelete = document.createElement('button'); btnDelete.className = 'btn btn-red';  btnDelete.textContent = 'VERWIJDER';

  // UPDATE
  btnUpdate.addEventListener('click', async (e) => {
    e.stopPropagation();
    btnUpdate.disabled = btnToggle.disabled = btnDelete.disabled = true;
    btnUpdate.textContent = 'OPSLAAN…';
    const payload = { stock: Math.max(0, Math.floor(Number(input.value || 0))) };
    try {
      const r = await authFetch(`/api/barmeester/drinks/${encodeURIComponent(d._id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const updated = await r.json().catch(()=> ({}));
      if (!r.ok) { alert(updated.error || 'Opslaan mislukt'); }
      else {
        right.textContent = `${updated.stock} stuks`;
        input.value = String(updated.stock);
        // naam/visibility kunnen ook gewijzigd zijn
        left.innerHTML = `${updated.name} <span class="${updated.active ? 'admin-eye' : 'admin-hide'}">${iconVisible(updated.active)}</span>`;
        btnToggle.textContent = updated.active ? 'VERBERG' : 'TOON';
        d = updated;
      }
    } catch {
      alert('Opslaan mislukt (verbinding).');
    }
    btnUpdate.textContent = 'UPDATE';
    btnUpdate.disabled = btnToggle.disabled = btnDelete.disabled = false;
  });

  // VERBERG / TOON
  btnToggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    btnUpdate.disabled = btnToggle.disabled = btnDelete.disabled = true;
    const nextActive = !d.active;
    try {
      const r = await authFetch(`/api/barmeester/drinks/${encodeURIComponent(d._id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: nextActive })
      });
      const updated = await r.json().catch(()=> ({}));
      if (!r.ok) { alert(updated.error || 'Wijzigen mislukt'); }
      else {
        d.active = !!updated.active;
        left.innerHTML = `${updated.name} <span class="${updated.active ? 'admin-eye' : 'admin-hide'}">${iconVisible(updated.active)}</span>`;
        btnToggle.textContent = updated.active ? 'VERBERG' : 'TOON';
      }
    } catch {
      alert('Wijzigen mislukt (verbinding).');
    }
    btnUpdate.disabled = btnToggle.disabled = btnDelete.disabled = false;
  });

  // VERWIJDER
  btnDelete.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Weet je zeker dat je “${d.name}” wilt verwijderen?`)) return;

    btnUpdate.disabled = btnToggle.disabled = btnDelete.disabled = true;
    btnDelete.textContent = 'VERWIJDEREN…';
    try {
      const r = await authFetch(`/api/barmeester/drinks/${encodeURIComponent(d._id)}`, { method: 'DELETE' });
      const js = await r.json().catch(()=> ({}));
      if (!r.ok) {
        alert(js.error || 'Verwijderen mislukt'); // toont servermelding (bv. ongeldige id)
      } else {
        item.remove();
      }
    } catch {
      alert('Verwijderen mislukt (verbinding).');
    }
  });

  actions.appendChild(btnUpdate);
  actions.appendChild(btnToggle);
  actions.appendChild(btnDelete);

  body.appendChild(input);
  body.appendChild(actions);

  item.appendChild(head);
  item.appendChild(body);

  head.addEventListener('click', () => {
    item.classList.toggle('active');
    if (item.classList.contains('active')) setTimeout(() => input.focus(), 0);
  });

  return item;
}

async function renderStock() {
  adminContent.innerHTML = '<p class="subtitle">Drankjes laden…</p>';
  try {
    const res = await authFetch('/api/barmeester/drinks');
    const drinks = await res.json();

    const list = document.createElement('div'); list.className = 'admin-list';
    adminContent.innerHTML = '';
    if (Array.isArray(drinks) && drinks.length) {
      drinks.forEach(d => list.appendChild(makeDrinkItem(d)));
    } else {
      list.innerHTML = '<p class="subtitle">Nog geen drankjes</p>';
    }

    // Nieuw drankje blok (onderaan)
    const newWrap = document.createElement('div'); newWrap.className = 'admin-new';

    const nameInput = document.createElement('input');
    nameInput.className = 'admin-input'; nameInput.placeholder = 'Naam drankje'; nameInput.type = 'text';
    nameInput.addEventListener('click', (e) => e.stopPropagation());

    const stockInput = document.createElement('input');
    stockInput.className = 'admin-input'; stockInput.placeholder = 'Voorraad'; stockInput.type = 'number';
    stockInput.inputMode = 'numeric'; stockInput.pattern = '[0-9]*';
    stockInput.addEventListener('click', (e) => e.stopPropagation());

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-green'; addBtn.textContent = 'DRANKJE TOEVOEGEN';
    addBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const payload = {
        name: (nameInput.value || '').trim(),
        stock: Math.max(0, Math.floor(Number(stockInput.value || 0))),
        active: true
      };
      if (!payload.name) { alert('Naam is verplicht'); return; }
      addBtn.disabled = true; addBtn.textContent = 'TOEVOEGEN…';
      try {
        const r = await authFetch('/api/barmeester/drinks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const created = await r.json().catch(()=> ({}));
        if (!r.ok) { alert(created.error || 'Toevoegen mislukt'); }
        else {
          list.insertBefore(makeDrinkItem(created), list.firstChild); // nieuw bovenaan
          nameInput.value = ''; stockInput.value = '';
        }
      } catch {
        alert('Toevoegen mislukt (verbinding).');
      }
      addBtn.disabled = false; addBtn.textContent = 'DRANKJE TOEVOEGEN';
    });

    newWrap.appendChild(nameInput);
    newWrap.appendChild(stockInput);
    newWrap.appendChild(addBtn);

    adminContent.appendChild(list);
    adminContent.appendChild(newWrap);
  } catch {
    adminContent.innerHTML = '<p class="subtitle" style="color:#fca5a5">Kon drankjes niet laden</p>';
  }
}

async function openStock() { showOverlay('Voorraad beheren'); renderStock(); }

// ====== 3) Dashboard openen ======
function openDashboard() { window.location.href = '/dashboard.html'; }

// ===== Events =====
document.addEventListener('DOMContentLoaded', ensureBarmeester);
grantBtn?.addEventListener('click', openGrant);
stockBtn?.addEventListener('click', openStock);
dashboardBtn?.addEventListener('click', openDashboard);
closeOverlayBtn?.addEventListener('click', hideOverlay);

// ESC en tik buiten de modal sluiten
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideOverlay(); });
overlay?.addEventListener('click', (e) => { if (e.target === overlay) hideOverlay(); });