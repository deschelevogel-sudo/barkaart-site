// public/app.js — Barkaart site (mobielvriendelijk, fullscreen popup + animaties + barmeester toggle)

// ========== Helpers ==========
function getToken() { 
  return localStorage.getItem('token'); 
}

function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    return Promise.reject(new Error('Niet ingelogd'));
  }
  return fetch(url, {
    ...options,
    headers: { 'Authorization': 'Bearer ' + token, ...(options.headers || {}) }
  }).then(async (res) => {
    if (res.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login.html';
      throw new Error('Niet geautoriseerd');
    }
    return res;
  });
}

// ========== UI refs ==========
const nameEl           = document.getElementById('displayName');
const streepjesEl      = document.getElementById('streepjes');
const pakDrankjeBtn    = document.getElementById('pakDrankjeBtn');

const overlay          = document.getElementById('overlay');
const drinksEl         = document.getElementById('drinks');
const confirmBox       = document.getElementById('confirm');
const chosenNameEl     = document.getElementById('chosenName');
const closeOverlayBtn  = document.getElementById('closeOverlay');
const cancelConfirmBtn = document.getElementById('cancelConfirm');
const confirmDrinkBtn  = document.getElementById('confirmDrink');

let selectedDrink = null;
let scrollLockPrevHtmlOverflow = '';
let scrollLockPrevBodyOverflow = '';
const CLOSE_ANIM_MS = 200; // match CSS ~180-220ms

// ========== Barmeester toggle ==========
function injectBarmeesterSwitch() {
  if (document.getElementById('toBarmeesterBtn')) return; // niet dubbel
  const header = document.querySelector('header');
  if (!header) return;

  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.style.display = 'flex';
  wrap.style.justifyContent = 'center';

  const btn = document.createElement('button');
  btn.id = 'toBarmeesterBtn';
  btn.textContent = 'Barmeester';
  btn.addEventListener('click', () => {
    window.location.href = '/barmeester.html';
  });

  wrap.appendChild(btn);
  header.appendChild(wrap);
}

// ========== Data laden ==========
async function loadMe() {
  try {
    const res = await authFetch('/api/me');
    const me = await res.json();
    nameEl.textContent = me.displayName || me.username || '';
    streepjesEl.textContent = typeof me.streepjes === 'number' ? me.streepjes : '—';

    // Toon barmeester-knop indien rol
    if (me.isBarmeester) injectBarmeesterSwitch();
  } catch {
    // authFetch stuurt naar login bij 401; geen extra melding nodig
  }
}

// ========== Scroll lock helpers ==========
function lockScroll() {
  const html = document.documentElement;
  const body = document.body;
  scrollLockPrevHtmlOverflow = html.style.overflow;
  scrollLockPrevBodyOverflow = body.style.overflow;
  html.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
}
function unlockScroll() {
  const html = document.documentElement;
  const body = document.body;
  html.style.overflow = scrollLockPrevHtmlOverflow || '';
  body.style.overflow = scrollLockPrevBodyOverflow || '';
}

// ========== Popup helpers ==========
function showOverlay() {
  overlay.classList.remove('closing');
  overlay.style.display = 'flex';
  overlay.offsetHeight; 
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  confirmBox.style.display = 'none';
  chosenNameEl && (chosenNameEl.textContent = '');
  confirmDrinkBtn.disabled = true;
  selectedDrink = null;

  drinksEl.querySelectorAll('.drink-btn.selected').forEach(b => b.classList.remove('selected'));
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
    confirmBox.style.display = 'none';
    chosenNameEl && (chosenNameEl.textContent = '');
    confirmDrinkBtn.disabled = true;
    selectedDrink = null;
    drinksEl.querySelectorAll('.drink-btn.selected').forEach(b => b.classList.remove('selected'));
    unlockScroll();
  }, CLOSE_ANIM_MS);
}

// ========== Drankjes open/kiezen ==========
async function openDrinks() {
  showOverlay();

  drinksEl.innerHTML = '<p class="subtitle">Laden…</p>';
  try {
    const res = await authFetch('/api/drinks');
    const drinks = await res.json();

    if (!Array.isArray(drinks) || drinks.length === 0) {
      drinksEl.innerHTML = '<p class="subtitle">Geen drankjes beschikbaar</p>';
      return;
    }

    drinksEl.innerHTML = '';
    for (const d of drinks) {
      const btn = document.createElement('button');
      btn.className = 'drink-btn';
      btn.textContent = d.name;
      btn.dataset.id = d._id || '';
      btn.dataset.name = d.name;

      btn.addEventListener('click', () => {
        drinksEl.querySelectorAll('.drink-btn.selected').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');

        selectedDrink = { _id: btn.dataset.id, name: btn.dataset.name };
        if (chosenNameEl) chosenNameEl.textContent = selectedDrink.name;
        confirmBox.style.display = 'block';
        confirmDrinkBtn.disabled = false;

        if (navigator.vibrate) navigator.vibrate(10);
      });

      drinksEl.appendChild(btn);
    }
  } catch {
    drinksEl.innerHTML = '<p class="subtitle" style="color:#fca5a5">Kon drankjes niet laden</p>';
  }
}

// ========== Bevestigen consumptie ==========
async function confirmDrink() {
  if (!selectedDrink) return;

  try {
    confirmDrinkBtn.disabled = true;
    const originalText = confirmDrinkBtn.textContent;
    confirmDrinkBtn.textContent = 'Bevestigen…';

    const res = await authFetch('/api/drinks/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drinkId: selectedDrink._id })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Er ging iets mis');
      confirmDrinkBtn.textContent = originalText;
      confirmDrinkBtn.disabled = false;
      return;
    }

    if (typeof data.streepjes === 'number') {
      streepjesEl.textContent = data.streepjes;
    }
    if (navigator.vibrate) navigator.vibrate(20);

    hideOverlay();
  } catch {
    alert('Kon niet bevestigen. Controleer je verbinding.');
    confirmDrinkBtn.disabled = false;
    confirmDrinkBtn.textContent = 'Bevestigen';
  }
}

// ========== Events ==========
document.addEventListener('DOMContentLoaded', loadMe);
pakDrankjeBtn?.addEventListener('click', openDrinks);
closeOverlayBtn?.addEventListener('click', hideOverlay);
cancelConfirmBtn?.addEventListener('click', hideOverlay);
confirmDrinkBtn?.addEventListener('click', confirmDrink);

// ESC en tik buiten de modal sluiten
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideOverlay();
});
overlay?.addEventListener('click', (e) => {
  if (e.target === overlay) hideOverlay();
});