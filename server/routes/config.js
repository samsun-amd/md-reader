const express = require('express');
const { reloadConfig } = require('../lib/paths');
const { resetRemote } = require('../lib/backend');

const router = express.Router();

// POST /api/config/reload  — re-read config.json from disk and update the cache.
// Also drops cached remote inventory/connections so edits to ssh_remote.json or
// remote roots take effect without a restart.
router.post('/reload', (req, res) => {
  try {
    const cfg = reloadConfig();
    resetRemote();
    res.json({
      ok: true,
      roots: cfg.roots.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        path: r.type === 'remote' ? `${r.node}:${r.remotePath}` : r.path,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
