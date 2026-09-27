// Aquarium Public backend entrypoint. Serves the frontend from ../public
// plus the JSON API under /api. Health check: GET /health -> {ok:true}.
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { openDb } = require('./db');
const { authRequired } = require('./auth');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');

async function main() {
  const db = await openDb();
  const app = express();

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', authRoutes(db));
  app.use('/api', authRequired(db), gameRoutes(db));

  // Frontend (single-container deploy): serve public/ for everything non-API.
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.use((req, res) => res.status(404).json({ ok: false, error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('unhandled error:', err);
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid JSON body' });
    }
    res.status(500).json({ ok: false, error: 'internal error' });
  });

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`aquarium-public backend listening on :${PORT} (db: ${db.describe()})`);
  });
}

main().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
