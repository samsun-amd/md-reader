const express = require('express');
const { reloadConfig } = require('../lib/paths');

const router = express.Router();

// POST /api/config/reload  — re-read config.json from disk and update the cache.
router.post('/reload', (req, res) => {
  try {
    const cfg = reloadConfig();
    res.json({ ok: true, roots: cfg.roots.map((r) => ({ name: r.name, path: r.path })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
