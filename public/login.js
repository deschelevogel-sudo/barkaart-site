// public/login.js

// Tabs toggle
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginCard = document.getElementById('loginCard');
const registerCard = document.getElementById('registerCard');

function showLogin() {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginCard.style.display = '';
  registerCard.style.display = 'none';
}
function showRegister() {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerCard.style.display = '';
  loginCard.style.display = 'none';
}
if (tabLogin && tabRegister) {
  tabLogin.addEventListener('click', showLogin);
  tabRegister.addEventListener('click', showRegister);
}

// ---- Inloggen ----
const loginForm = document.getElementById('login-form');
const loginErr = document.getElementById('login-error');

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginErr.style.display = 'none';

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Inloggen mislukt');

    localStorage.setItem('token', json.token);
    window.location.href = '/app.html';
  } catch (e) {
    loginErr.textContent = e.message || 'Inloggen mislukt';
    loginErr.style.display = 'block';
  }
});

// ---- Registreren ----
const regForm = document.getElementById('register-form');
const regErr = document.getElementById('register-error');

regForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  regErr.style.display = 'none';

  const username = document.getElementById('reg-username').value.trim();
  const displayName = document.getElementById('reg-display').value.trim();
  const password = document.getElementById('reg-password').value;

  if (password.length < 6) {
    regErr.textContent = 'Wachtwoord moet minimaal 6 tekens zijn';
    regErr.style.display = 'block';
    return;
    }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Registreren mislukt');

    localStorage.setItem('token', json.token);
    window.location.href = '/app.html';
  } catch (e) {
    regErr.textContent = e.message || 'Registreren mislukt';
    regErr.style.display = 'block';
  }
});