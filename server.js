if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const articleRoutes = require('./routes/articles');
const commentRoutes = require('./routes/comments');
const newsletterRoutes = require('./routes/newsletter');
const adminRoutes = require('./routes/admin');
const cryptoRoutes = require('./routes/crypto');
const rankingsRoutes = require('./routes/rankings');
const uploadRoutes = require('./routes/upload');
const advertiserRoutes = require('./routes/advertisers');
const placementRoutes = require('./routes/placements');
const creativeRoutes = require('./routes/creatives');
const campaignRoutes = require('./routes/campaigns');
const advertisementRoutes = require('./routes/advertisements');
const advertisingInventoryRoutes = require('./routes/advertisingInventory');
const adSettingsRoutes = require('./routes/adSettings');
const diagnoseRoutes = require('./routes/diagnose');
const AdPlacement = require('./models/AdPlacement');

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

let cached = global._mongooseConn;
if (!cached) {
  cached = global._mongooseConn = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      bufferCommands: false,
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// Ensures the 9 required default placements exist. Guarded by a
// module-level flag (same caching pattern as the Mongo connection above)
// so it only runs once per warm server instance, not on every request —
// the upsert inside seedDefaults() is idempotent either way, this just
// avoids the redundant DB round-trip on every hit.
let placementsSeeded = false;
async function ensureDefaultPlacements() {
  if (placementsSeeded) return;
  placementsSeeded = true;
  try {
    await AdPlacement.seedDefaults();
  } catch (err) {
    console.error('Placement seeding error:', err.message);
    placementsSeeded = false; // allow a retry on the next request
  }
}

app.use(async (req, res, next) => {
  try {
    await connectDB();
    await ensureDefaultPlacements();
    next();
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    res.status(500).json({ message: 'Database connection error' });
  }
});

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'CoinGabbarSignals API', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/crypto', cryptoRoutes);
app.use('/api/rankings', rankingsRoutes);
app.use('/api', uploadRoutes);
app.use('/api/advertisers', advertiserRoutes);
app.use('/api/placements', placementRoutes);
app.use('/api/creatives', creativeRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/advertisements', advertisementRoutes);
// PART 12A — Content Console's Advertising -> Inventory screen. Read-only
// aggregation over the same Placement/Campaign/Advertisement data the
// routes above already own; registered as its own resource (not nested
// under /api/placements or /api/advertisements) since it spans both.
app.use('/api/advertising/inventory', advertisingInventoryRoutes);
app.use('/api/advertising/settings', adSettingsRoutes);
app.use('/api/diagnose', diagnoseRoutes);

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nSitemap: ${process.env.CLIENT_URL || ''}/sitemap.xml`
  );
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Server error' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`CoinGabbarSignals API running on port ${PORT}`));
  });
}

module.exports = app;
