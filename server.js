// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();

// --- Hosting / poorten ---
const PORT = process.env.PORT || 3000;   // Railway zet PORT automatisch
const HOST = '0.0.0.0';                  // luistert op alle interfaces

app.use(express.json());

// =====================================
// In-memory token store (demo)
// =====================================
const activeTokens = new Map();

// ===== Helpers: wachtwoord hashing =====
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// =====================================
// Demo-auth fallback
// =====================================
const DEMO_USER = process.env.LOGIN_USER || 'admin';
const DEMO_PASS = process.env.LOGIN_PASS || 'admin123';

// =====================================
// Barmeester-config (env) - case-insensitive
// =====================================

const BARMEESTER_USERS_RAW =
  (process.env.BARMEESTER_USERS && process.env.BARMEESTER_USERS.trim().length > 0)
    ? process.env.BARMEESTER_USERS
    : 'admin,Bartmeister,Joran'; // <-- fallback als env leeg is


const BARMEESTER_USERS = BARMEESTER_USERS_RAW
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function isBarmeesterUser(username) {
  // Als geen BARMEESTER_USERS is gezet: alleen demo-user is barmeester
  if (BARMEESTER_USERS.length === 0) {
    return (username || '').toLowerCase() === (DEMO_USER || 'admin').toLowerCase();
  }
  return BARMEESTER_USERS.includes(String(username).toLowerCase());
}

function requireBarmeester(req, res, next) {
  const ok = isBarmeesterUser(req.username);
  // Handige debug; haal weg als je wilt.
  console.log('[IS-BAR]', { username: req.username, BARMEESTER_USERS, ok });
  if (ok) return next();
  return res.status(403).json({ error: 'Geen toegang (barmeester)' });
}

// =====================================
// Auth-middleware (token uit Authorization: Bearer ...)
// =====================================
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const username = token ? activeTokens.get(token) : null;
  if (!username) return res.status(401).json({ error: 'Niet geautoriseerd' });
  req.username = username;
  next();
}

// =====================================
// MongoDB: URI en connectie
// =====================================
// Gebruik MONGODB_URI (Atlas conventie) of MONGO_URI (alternatieve naam)
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Geen MONGO_URI / MONGODB_URI gevonden. Zet deze in Railway → Variables.');
  process.exit(1);
}

// Moderne (bescheiden) timeouts om sneller duidelijke fouten te krijgen
const mongooseOptions = {
  serverSelectionTimeoutMS: 10000,
};

// =====================================
// Modellen
// =====================================
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, index: true },
  displayName: { type: String, default: '' },
  streepjes: { type: Number, default: 10 },
  passwordHash: { type: String, default: '' },
  passwordSalt: { type: String, default: '' },
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const drinkSchema = new mongoose.Schema({
  name:   { type: String, required: true },
  price:  { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  stock:  { type: Number, default: 0 },
}, { timestamps: true });
const Drink = mongoose.model('Drink', drinkSchema);

// ===== Seed drankjes (alleen wanneer DB leeg is) =====
async function seedIfNeeded() {
  const count = await Drink.estimatedDocumentCount();
  if (count === 0) {
    await Drink.insertMany([
      { name: 'Bier',         stock: 30, active: true },
      { name: 'Wijn',         stock: 20, active: true },
      { name: 'Cola',         stock: 24, active: true },
      { name: 'Water',        stock: 24, active: true },
      { name: 'Speciaalbier', stock: 12, active: true },
    ]);
    console.log('🍻 Standaard drankjes toegevoegd (incl. voorraad)');
  }
}

// =====================================
// API-routes
// =====================================

// Registreren
app.post('/api/auth/register', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database niet beschikbaar. Probeer het zo opnieuw.' });
    }
    let { username, password, displayName } = req.body || {};
    username = (username || '').trim();
    password = (password || '');
    displayName = (displayName || '').trim();

    if (!username || !password) return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });
    if (password.length < 6) return res.status(400).json({ error: 'Wachtwoord moet minimaal 6 tekens zijn' });
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username))
      return res.status(400).json({ error: 'Gebruikersnaam moet 3-32 tekens zijn (letters/cijfers/._-)' });

    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(409).json({ error: 'Gebruikersnaam is al in gebruik' });

    const { salt, hash } = hashPassword(password);
    const user = await User.create({
      username,
      displayName: displayName || username,
      streepjes: 10,
      passwordHash: hash,
      passwordSalt: salt,
    });

    const token = crypto.randomUUID();
    activeTokens.set(token, user.username);
    return res.status(201).json({
      token,
      user: { name: user.username, displayName: user.displayName, streepjes: user.streepjes }
    });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: 'Gebruikersnaam is al in gebruik' });
    console.error('[REGISTER] Onverwachte fout:', e);
    return res.status(500).json({ error: 'Interne serverfout tijdens registreren' });
  }
});

// Inloggen
app.post('/api/auth/login', async (req, res) => {
  try {
    let { username, password } = req.body || {};
    username = (username || '').trim();
    password = (password || '');

    if (!username || !password) return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });

    const user = await User.findOne({ username });
    if (user && user.passwordSalt && user.passwordHash) {
      const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Ongeldige inloggegevens' });
      const token = crypto.randomUUID();
      activeTokens.set(token, user.username);
      return res.json({
        token,
        user: { name: user.username, displayName: user.displayName, streepjes: user.streepjes }
      });
    }

    // Fallback demo
    if (username === DEMO_USER && password === DEMO_PASS) {
      let demo = await User.findOne({ username: DEMO_USER });
      if (!demo) demo = await User.create({ username: DEMO_USER, displayName: DEMO_USER, streepjes: 10 });
      const token = crypto.randomUUID();
      activeTokens.set(token, DEMO_USER);
      return res.json({
        token,
        user: { name: demo.username, displayName: demo.displayName, streepjes: demo.streepjes }
      });
    }

    return res.status(401).json({ error: 'Ongeldige inloggegevens' });
  } catch (e) {
    console.error('[LOGIN] Onverwachte fout:', e);
    return res.status(500).json({ error: 'Interne serverfout tijdens inloggen' });
  }
});

// Huidige user + barmeester-flag
app.get('/api/me', requireAuth, async (req, res) => {
  let user = await User.findOne({ username: req.username });
  if (!user) user = await User.create({ username: req.username, displayName: req.username, streepjes: 10 });
  res.json({
    username: user.username,
    displayName: user.displayName || user.username,
    streepjes: user.streepjes,
    isBarmeester: isBarmeesterUser(user.username)
  });
});

// Drankjes (afstrepers)
app.get('/api/drinks', requireAuth, async (req, res) => {
  const drinks = await Drink.find({ active: true }).sort({ name: 1 });
  res.json(drinks);
});

app.post('/api/drinks/consume', requireAuth, async (req, res) => {
  const { drinkId } = req.body || {};
  const user = await User.findOne({ username: req.username });
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  if (user.streepjes <= 0) return res.status(400).json({ error: 'Geen streepjes meer over' });

  if (drinkId) {
    const exists = await Drink.exists({ _id: drinkId, active: true });
    if (!exists) return res.status(400).json({ error: 'Drankje bestaat niet' });
  }

  user.streepjes -= 1;
  await user.save();
  res.json({ ok: true, streepjes: user.streepjes });
});

// ===== Barmeester =====
app.get('/api/barmeester/users', requireAuth, requireBarmeester, async (req, res) => {
  const users = await User.find({}, { username: 1, displayName: 1, streepjes: 1 })
    .sort({ displayName: 1, username: 1 });
  res.json(users);
});

app.post('/api/barmeester/users/:username/grant-barkaart', requireAuth, requireBarmeester, async (req, res) => {
  const amount = Number(req.body?.amount ?? 7);
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  user.streepjes += isNaN(amount) ? 7 : amount;
  await user.save();
  res.json({ ok: true, username: user.username, streepjes: user.streepjes });
});

app.get('/api/barmeester/drinks', requireAuth, requireBarmeester, async (req, res) => {
  const drinks = await Drink.find().sort({ name: 1 });
  res.json(drinks);
});

app.patch('/api/barmeester/drinks/:id', requireAuth, requireBarmeester, async (req, res) => {
  const { stock, active, name } = req.body || {};
  const update = {};
  if (typeof stock === 'number') update.stock = Math.max(0, Math.floor(stock));
  if (typeof active === 'boolean') update.active = active;
  if (typeof name === 'string' && name.trim()) update.name = name.trim();

  if (!mongoose.isValidObjectId(req.params.id)) {
    console.warn('[DRINK PATCH] Ongeldige id:', req.params.id);
    return res.status(400).json({ error: 'Ongeldige drank-id' });
  }

  const drink = await Drink.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!drink) return res.status(404).json({ error: 'Drankje niet gevonden' });
  res.json(drink);
});

app.delete('/api/barmeester/drinks/:id', requireAuth, requireBarmeester, async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    console.warn('[DRINK DELETE] Ongeldige id:', id);
    return res.status(400).json({ error: 'Ongeldige drank-id' });
  }

  try {
    const deleted = await Drink.findByIdAndDelete(id);
    if (!deleted) {
      console.warn('[DRINK DELETE] Niet gevonden id:', id);
      return res.status(404).json({ error: 'Drankje niet gevonden' });
    }
    console.log('[DRINK DELETE] Verwijderd:', deleted.name, deleted._id.toString());
    return res.json({ ok: true });
  } catch (e) {
    console.error('[DRINK DELETE] Fout:', e);
    return res.status(500).json({ error: 'Verwijderen mislukt door serverfout' });
  }
});

// =====================================
// Static files
// =====================================
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/app.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/barmeester.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'barmeester.html')));

// Laatste fallback naar login (API-routes zitten hierboven, dus geen conflict)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// =====================================
// Starten: eerst DB connect, dan server
// =====================================
async function main() {
  try {
    console.log('⏳ Verbinding maken met MongoDB...');
    await mongoose.connect(MONGO_URI, mongooseOptions);
    console.log('✅ Verbonden met MongoDB');

    // seed pas nadat de DB verbonden is
    await seedIfNeeded();

    app.listen(PORT, HOST, () => {
      const publicUrl =
        process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : `http://localhost:${PORT}`;
      console.log(`🚀 Server online: ${publicUrl}`);
    });
  } catch (err) {
    console.error('❌ Kon niet verbinden met MongoDB:', err.message);
    process.exit(1); // laat Railway opnieuw starten / maakt de fout duidelijk
  }
}

main();

// Graceful shutdown (optioneel, netjes afsluiten)
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM ontvangen - Mongoose afsluiten...');
  await mongoose.connection.close();
  process.exit(0);
});
