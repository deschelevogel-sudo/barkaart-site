// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.json());

// Token → username (in-memory demo)
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

// ===== MongoDB =====
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/simple_mongo_site';
mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('✅ Verbonden met MongoDB'))
  .catch((err) => console.error('❌ Fout bij verbinden met MongoDB:', err.message));

// ===== Modellen =====
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, index: true },
  displayName: { type: String, default: '' },
  streepjes: { type: Number, default: 0 },
  passwordHash: { type: String, default: '' },
  passwordSalt: { type: String, default: '' },
  isBarmeester: { type: Boolean, default: false }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const drinkSchema = new mongoose.Schema({
  name: { type: String, required: true },
  // 'price' kan blijven staan voor latere uitbreidingen; verkoopprijs bepalen we dynamisch via settings/stripsCost
  price: { type: Number, default: 0 },
  active: { type: Boolean, default: true }, // zichtbaar voor afstrepers
  stock: { type: Number, default: 0 },      // voorraad
  stripsCost: { type: Number, default: 1, min: 1 },   // streepjes per drankje (standaard 1)
  purchasePrice: { type: Number, default: 0, min: 0 } // inkoopprijs per stuk
}, { timestamps: true });
const Drink = mongoose.model('Drink', drinkSchema);

// Seed drankjes bij lege collectie
(async () => {
  try {
    const count = await Drink.estimatedDocumentCount();
    if (count === 0) {
      await Drink.insertMany([
        { name: 'Bier', stock: 30, active: true },
        { name: 'Wijn', stock: 20, active: true },
        { name: 'Cola', stock: 24, active: true },
        { name: 'Water', stock: 24, active: true },
        { name: 'Speciaalbier', stock: 12, active: true },
      ]);
      console.log('🍻 Standaard drankjes toegevoegd (incl. voorraad)');
    }
  } catch (e) {
    console.warn('⚠️ Kon drankjes niet seeden:', e.message);
  }
})();

// ===== Model: Consumption (auditlog) =====
const consumptionSchema = new mongoose.Schema({
  username: { type: String, required: true, index: true },
  userDisplayName: { type: String, default: '' },
  drinkId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drink', required: false },
  drinkName: { type: String, required: true }, // denormalized voor eenvoud/rapportage
  price: { type: Number, default: 0 }, // optioneel
  beforeStreepjes: { type: Number, required: true }, // saldo vóór aftrek
  afterStreepjes: { type: Number, required: true },  // saldo na aftrek
  ip: { type: String, default: '' }, // optioneel: client IP
}, { timestamps: true });
consumptionSchema.index({ createdAt: -1 });
consumptionSchema.index({ drinkName: 1, createdAt: -1 });
const Consumption = mongoose.model('Consumption', consumptionSchema);

// ===== Model: Settings (singleton) =====
const settingsSchema = new mongoose.Schema({
  pricePerCard: { type: Number, default: 14.00, min: 0 }, // prijs per barkaart
  stripsPerCard: { type: Number, default: 7, min: 1 },    // streepjes per barkaart
  cashOpeningBalance: { type: Number, default: 0, min: 0 }, // beginstand kas
  cashOpeningDate: { type: Date, default: Date.now }
}, { timestamps: true });
const Settings = mongoose.model('Settings', settingsSchema);
// Helper om altijd een document te hebben
async function getOrCreateSettings() {
  let doc = await Settings.findOne();
  if (!doc) doc = await Settings.create({});
  return doc;
}

// ===== Model: FinanceTransaction =====
const financeTransactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['INFLOW', 'OUTFLOW'], required: true }, // +/- (storting / uitgave)
  amount: { type: Number, required: true, min: 0 },
  note: { type: String, default: '' },
  by: { type: String, required: true }, // username die de transactie aanmaakt
}, { timestamps: true });
financeTransactionSchema.index({ createdAt: -1 });
const FinanceTx = mongoose.model('FinanceTx', financeTransactionSchema);

// ===== Demo-auth fallback =====
const DEMO_USER = process.env.LOGIN_USER || 'admin';
const DEMO_PASS = process.env.LOGIN_PASS || 'admin123';

// ===== Registreren =====
app.post('/api/auth/register', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database niet beschikbaar. Probeer het zo opnieuw.' });
    }
    let { username, password, displayName } = req.body ?? {};
    username = (username ?? '').trim();
    password = (password ?? '');
    displayName = (displayName ?? '').trim();

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
      streepjes: 0,
      passwordHash: hash,
      passwordSalt: salt,
    });

    const token = crypto.randomUUID();
    activeTokens.set(token, user.username);
    return res.status(201).json({ token, user: { name: user.username, displayName: user.displayName, streepjes: user.streepjes } });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: 'Gebruikersnaam is al in gebruik' });
    console.error('[REGISTER] Onverwachte fout:', e);
    return res.status(500).json({ error: 'Interne serverfout tijdens registreren' });
  }
});

// ===== Inloggen =====
app.post('/api/auth/login', async (req, res) => {
  try {
    let { username, password } = req.body ?? {};
    username = (username ?? '').trim();
    password = (password ?? '');

    if (!username || !password) return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });

    const user = await User.findOne({ username });
    if (user && user.passwordSalt && user.passwordHash) {
      const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Ongeldige inloggegevens' });
      const token = crypto.randomUUID();
      activeTokens.set(token, user.username);
      return res.json({ token, user: { name: user.username, displayName: user.displayName, streepjes: user.streepjes } });
    }

    // Fallback demo
    if (username === DEMO_USER && password === DEMO_PASS) {
      let demo = await User.findOne({ username: DEMO_USER });
      if (!demo) demo = await User.create({ username: DEMO_USER, displayName: DEMO_USER, streepjes: 10 });
      const token = crypto.randomUUID();
      activeTokens.set(token, DEMO_USER);
      return res.json({ token, user: { name: demo.username, displayName: demo.displayName, streepjes: demo.streepjes } });
    }

    return res.status(401).json({ error: 'Ongeldige inloggegevens' });
  } catch (e) {
    console.error('[LOGIN] Onverwachte fout:', e);
    return res.status(500).json({ error: 'Interne serverfout tijdens inloggen' });
  }
});

// ===== Auth-middleware =====
function requireAuth(req, res, next) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const username = token ? activeTokens.get(token) : null;
  if (!username) return res.status(401).json({ error: 'Niet geautoriseerd' });
  req.username = username;
  next();
}

// Barmeester-rechten
async function isBarmeesterUser(username) {
  const u = await User.findOne({ username }, { isBarmeester: 1 }).lean();
  // Fallback: als er nog GEEN enkele barmeester bestaat, treat DEMO_USER als barmeester
  if (!u) {
    const anyAdmin = await User.exists({ isBarmeester: true });
    return !anyAdmin && username === DEMO_USER;
  }
  return !!u.isBarmeester;
}
async function requireBarmeester(req, res, next) {
  try {
    if (await isBarmeesterUser(req.username)) return next();
    return res.status(403).json({ error: 'Geen toegang (barmeester)' });
  } catch (e) {
    console.error('[AUTH BM] Fout:', e);
    return res.status(500).json({ error: 'Autorisatie mislukt' });
  }
}

// ===== API: afstrepers =====
app.get('/api/me', requireAuth, async (req, res) => {
  let user = await User.findOne({ username: req.username });
  if (!user) user = await User.create({ username: req.username, displayName: req.username, streepjes: 10 });
  res.json({
    username: user.username,
    displayName: user.displayName || user.username,
    streepjes: user.streepjes,
    isBarmeester: !!user.isBarmeester
  });
});

app.get('/api/drinks', requireAuth, async (req, res) => {
  const drinks = await Drink.find({ active: true }).sort({ name: 1 });
  res.json(drinks);
});

app.post('/api/drinks/consume', requireAuth, async (req, res) => {
  try {
    const { drinkId } = req.body ?? {};
    const user = await User.findOne({ username: req.username });
    if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });

    let drink = null;
    if (drinkId) {
      if (!mongoose.isValidObjectId(drinkId)) return res.status(400).json({ error: 'Ongeldige drank-id' });
      drink = await Drink.findOne({ _id: drinkId, active: true });
      if (!drink) return res.status(400).json({ error: 'Drankje bestaat niet of is inactief' });
    }

    const before = user.streepjes;
    user.streepjes = before - 1;
    if (drink && typeof drink.stock === 'number' && drink.stock > 0) {
      drink.stock = Math.max(0, drink.stock - 1);
    }
    await user.save();
    if (drink) await drink.save();

    await Consumption.create({
      username: user.username,
      userDisplayName: user.displayName || user.username,
      drinkId: drink ? drink._id : undefined,
      drinkName: drink ? drink.name : 'Onbekend',
      price: drink?.price ?? 0,
      beforeStreepjes: before,
      afterStreepjes: user.streepjes,
      ip: (typeof req.ip === 'string' ? req.ip : '')
    });

    return res.json({ ok: true, streepjes: user.streepjes });
  } catch (e) {
    console.error('[CONSUME] Fout:', e);
    return res.status(500).json({ error: 'Kon consumptie niet registreren' });
  }
});

// ===== API: Barmeester =====
app.get('/api/barmeester/users', requireAuth, requireBarmeester, async (req, res) => {
  const users = await User.find({}, { username: 1, displayName: 1, streepjes: 1 }).sort({ displayName: 1, username: 1 });
  res.json(users);
});

// ===== API: Barmeester — Admins beheren =====
app.get('/api/barmeester/admins', requireAuth, requireBarmeester, async (req, res) => {
  const admins = await User.find({ isBarmeester: true }, { username: 1, displayName: 1 }).sort({ displayName: 1, username: 1 }).lean();
  res.json(admins);
});

app.post('/api/barmeester/admins/:username', requireAuth, requireBarmeester, async (req, res) => {
  const uname = String(req.params.username || '').trim();
  if (!uname) return res.status(400).json({ error: 'Ongeldige gebruikersnaam' });
  const updated = await User.findOneAndUpdate({ username: uname }, { $set: { isBarmeester: true } }, { new: true });
  if (!updated) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  res.json({ ok: true, username: updated.username, isBarmeester: updated.isBarmeester });
});

app.delete('/api/barmeester/admins/:username', requireAuth, requireBarmeester, async (req, res) => {
  const uname = String(req.params.username || '').trim();
  if (!uname) return res.status(400).json({ error: 'Ongeldige gebruikersnaam' });

  // voorkomen dat je de LAATSTE barmeester verwijdert
  const count = await User.countDocuments({ isBarmeester: true });
  if (count <= 1) return res.status(400).json({ error: 'Kan de laatste barmeester niet verwijderen' });

  const updated = await User.findOneAndUpdate({ username: uname }, { $set: { isBarmeester: false } }, { new: true });
  if (!updated) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  res.json({ ok: true, username: updated.username, isBarmeester: updated.isBarmeester });
});

// ----- Settings (barmeester) -----
app.get('/api/barmeester/settings', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const s = await getOrCreateSettings();
    res.json({
      pricePerCard: s.pricePerCard,
      stripsPerCard: s.stripsPerCard,
      cashOpeningBalance: s.cashOpeningBalance,
      cashOpeningDate: s.cashOpeningDate
    });
  } catch (e) {
    console.error('[SETTINGS GET] Fout:', e);
    res.status(500).json({ error: 'Kon instellingen niet laden' });
  }
});

app.patch('/api/barmeester/settings', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const s = await getOrCreateSettings();
    const b = req.body ?? {};

    if (typeof b.pricePerCard !== 'undefined') {
      const v = Number(String(b.pricePerCard));
      if (!isFinite(v) || v <= 0) return res.status(400).json({ error: 'Ongeldige prijs per barkaart' });
      s.pricePerCard = v;
    }
    if (typeof b.stripsPerCard !== 'undefined') {
      const v = Math.floor(Number(b.stripsPerCard));
      if (!isFinite(v) || v <= 0) return res.status(400).json({ error: 'Ongeldig aantal streepjes per barkaart' });
      s.stripsPerCard = v;
    }
    if (typeof b.cashOpeningBalance !== 'undefined') {
      const v = Number(String(b.cashOpeningBalance));
      if (!isFinite(v) || v < 0) return res.status(400).json({ error: 'Ongeldige beginstand kas' });
      s.cashOpeningBalance = v;
    }
    if (typeof b.cashOpeningDate !== 'undefined') {
      const d = new Date(b.cashOpeningDate);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'Ongeldige datum voor beginstand' });
      s.cashOpeningDate = d;
    }

    await s.save();
    res.json({
      pricePerCard: s.pricePerCard,
      stripsPerCard: s.stripsPerCard,
      cashOpeningBalance: s.cashOpeningBalance,
      cashOpeningDate: s.cashOpeningDate
    });
  } catch (e) {
    console.error('[SETTINGS PATCH] Fout:', e);
    res.status(500).json({ error: 'Kon instellingen niet opslaan' });
  }
});

// ----- Drinks beheer (barmeester) -----
app.get('/api/barmeester/drinks', requireAuth, requireBarmeester, async (req, res) => {
  const drinks = await Drink.find().sort({ name: 1 });
  res.json(drinks);
});

app.patch('/api/barmeester/drinks/:id', requireAuth, requireBarmeester, async (req, res) => {
  const { stock, active, name, stripsCost, purchasePrice } = req.body ?? {};
  const update = {};
  if (typeof stock === 'number') update.stock = Math.max(0, Math.floor(stock));
  if (typeof active === 'boolean') update.active = active;
  if (typeof name === 'string' && name.trim()) update.name = name.trim();
  if (typeof stripsCost === 'number') {
    const v = Math.max(1, Math.floor(stripsCost));
    update.stripsCost = v;
  }
  if (typeof purchasePrice === 'number') {
    const v = Math.max(0, Number(purchasePrice));
    update.purchasePrice = v;
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    console.warn('[DRINK PATCH] Ongeldige id:', req.params.id);
    return res.status(400).json({ error: 'Ongeldige drank-id' });
  }
  const drink = await Drink.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!drink) return res.status(404).json({ error: 'Drankje niet gevonden' });
  res.json(drink);
});

// ✅ VERWIJDEREN — met id-validatie en duidelijke logs/antwoorden
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

// ----- Barkaart toekennen (barmeester) -----
app.post('/api/barmeester/users/:username/grant-barkaart', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const amount = Number(req.body?.amount ?? 7);
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });

    const inc = isNaN(amount) ? 7 : amount;
    const before = user.streepjes;
    user.streepjes = before + inc;
    await user.save();

    // Kas: 1 barkaart toegekend ⇒ inflow met barkaartprijs
    const s = await getOrCreateSettings();
    const cardPrice = Number(s.pricePerCard) > 0 ? Number(s.pricePerCard) : 0;
    if (cardPrice > 0) {
      await FinanceTx.create({
        type: 'INFLOW',
        amount: cardPrice,
        note: `Barkaart toekenning (+${inc})`,
        by: req.username
      });
    }

    // Loggen in Consumption (positieve delta)
    await Consumption.create({
      username: user.username,
      userDisplayName: user.displayName || user.username,
      drinkId: undefined,
      drinkName: 'Barkaart toekenning',
      price: 0,
      beforeStreepjes: before,
      afterStreepjes: user.streepjes,
      ip: (typeof req.ip === 'string' ? req.ip : '')
    });

    return res.json({ ok: true, username: user.username, streepjes: user.streepjes });
  } catch (e) {
    console.error('[GRANT] Fout:', e);
    return res.status(500).json({ error: 'Kon toekenning niet verwerken' });
  }
});

// ----- Finance -----
app.get('/api/finance/summary', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const s = await getOrCreateSettings();
    const opening = Number(s.cashOpeningBalance) || 0;

    const aggr = await FinanceTx.aggregate([
      {
        $group: {
          _id: null,
          inflow: { $sum: { $cond: [{ $eq: ['$type', 'INFLOW'] }, '$amount', 0] } },
          outflow: { $sum: { $cond: [{ $eq: ['$type', 'OUTFLOW'] }, '$amount', 0] } }
        }
      }
    ]);

    const inflow = aggr[0]?.inflow || 0;
    const outflow = aggr[0]?.outflow || 0;
    const balance = opening + inflow - outflow;

    res.json({
      openingBalance: opening,
      inflow,
      outflow,
      balance,
      pricePerCard: Number(s.pricePerCard) || 0,
      stripsPerCard: Number(s.stripsPerCard) || 0,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[FINANCE SUMMARY] Fout:', e);
    res.status(500).json({ error: 'Kon kasoverzicht niet laden' });
  }
});

app.get('/api/finance/transactions', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit ?? '100', 10)));
    const tx = await FinanceTx.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json(tx);
  } catch (e) {
    console.error('[FINANCE LIST] Fout:', e);
    res.status(500).json({ error: 'Kon transacties niet laden' });
  }
});

app.post('/api/finance/transactions', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const { type = 'OUTFLOW', amount, note = '' } = req.body ?? {};
    const amt = Number(String(amount).replace(',', '.'));
    if (!['INFLOW', 'OUTFLOW'].includes(type)) {
      return res.status(400).json({ error: 'Ongeldig type (INFLOW/OUTFLOW)' });
    }
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Ongeldig bedrag' });

    const created = await FinanceTx.create({
      type,
      amount: amt,
      note: String(note).slice(0, 240),
      by: req.username
    });
    res.status(201).json(created);
  } catch (e) {
    console.error('[FINANCE CREATE] Fout:', e);
    res.status(500).json({ error: 'Kon transactie niet opslaan' });
  }
});

// Handig: drinks + berekende verkoopprijs en marge
app.get('/api/barmeester/drinks-with-margins', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const s = await getOrCreateSettings();
    const pricePerStrip = (Number(s.pricePerCard) > 0 && Number(s.stripsPerCard) > 0)
      ? Number(s.pricePerCard) / Number(s.stripsPerCard)
      : 0;

    const drinks = await Drink.find().sort({ name: 1 }).lean();
    const data = drinks.map(d => {
      const strips = Math.max(1, Number(d.stripsCost ?? 1));
      const purchase = Math.max(0, Number(d.purchasePrice ?? 0));
      const sale = strips * pricePerStrip; // verkoopprijs
      const profit = sale - purchase;
      const marginPct = purchase > 0 ? (profit / purchase) * 100 : null;
      return {
        ...d,
        pricePerStrip,
        salePrice: sale,
        profit,
        marginPct
      };
    });
    res.json(data);
  } catch (e) {
    console.error('[DRINKS MARGINS] Fout:', e);
    res.status(500).json({ error: 'Kon marges niet berekenen' });
  }
});

// ===== Dashboard endpoints =====
function getRange(req) {
  const now = new Date();
  const to = req.query.to ? new Date(req.query.to) : now;
  const from = req.query.from ? new Date(req.query.from) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    const err = new Error('Ongeldige from/to');
    err.status = 400;
    throw err;
  }
  return { from, to };
}

// 1) Ruwe transacties (consumpties + toekenningen)
app.get('/api/dashboard/transactions', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const { from, to } = getRange(req);
    const docs = await Consumption.find({ createdAt: { $gte: from, $lte: to } })
      .sort({ createdAt: -1 }).lean();
    res.json(docs);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Kon transacties niet laden' });
  }
});

// Aliassen voor compatibiliteit met de front-end
app.get('/api/transactions', requireAuth, requireBarmeester, async (req, res) => {
  req.url = '/api/dashboard/transactions' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  app._router.handle(req, res);
});
app.get('/api/logs', requireAuth, requireBarmeester, async (req, res) => {
  req.url = '/api/dashboard/transactions' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  app._router.handle(req, res);
});

// 2) (Optioneel) Top drankjes server-side
app.get('/api/dashboard/top-drinks', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const { from, to } = getRange(req);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit ?? '5', 10)));
    const pipeline = [
      { $match: { createdAt: { $gte: from, $lte: to } } },
      { $addFields: { delta: { $subtract: ['$afterStreepjes', '$beforeStreepjes'] } } },
      { $match: { delta: { $lt: 0 } } }, // alleen consumpties
      { $addFields: { qty: { $abs: '$delta' } } },
      { $group: { _id: '$drinkName', count: { $sum: '$qty' } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      { $project: { _id: 0, name: '$_id', count: 1 } }
    ];
    const data = await Consumption.aggregate(pipeline);
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Kon top-drankjes niet samenstellen' });
  }
});

// 3) (Optioneel) Summary server-side
app.get('/api/dashboard/summary', requireAuth, requireBarmeester, async (req, res) => {
  try {
    const { from, to } = getRange(req);
    const docs = await Consumption.find({ createdAt: { $gte: from, $lte: to } }).lean();
    const delta = t => (Number(t.afterStreepjes) - Number(t.beforeStreepjes)) || 0;
    const qty = t => Math.abs(delta(t)) || 1;

    const cons = docs.filter(t => delta(t) < 0);
    const grants = docs.filter(t => delta(t) > 0);
    const totalConsumpties = cons.reduce((s, t) => s + qty(t), 0);
    const totalGrants = grants.reduce((s, t) => s + qty(t), 0);
    const netStreepjes = totalConsumpties - totalGrants;
    const uniekeGebruikers = new Set(docs.map(t => t.username)).size;

    const hasPrice = docs.some(t => (Number(t.price) || 0) > 0);
    const omzet = hasPrice ? docs.reduce((s, t) => s + (Number(t.price) || 0) * qty(t), 0) : 0;

    res.json({ totalConsumpties, totalGrants, netStreepjes, uniekeGebruikers, omzet });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Kon summary niet opstellen' });
  }
});

// ===== Static =====
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/app.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/barmeester.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'barmeester.html')));
app.get('/financien.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'financien.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.listen(PORT, HOST, () => {
  console.log(`🚀 Barkaart site draait op http://localhost:${PORT}`);
  console.log('📱 Benaderbaar op jouw netwerk: http://<jouw-computer-IP>:' + PORT);
});
