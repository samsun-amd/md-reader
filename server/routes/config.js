const express = require('express');
const { reloadConfig } = require('../lib/paths');
const { resetRemote } = require('../lib/backend');
const {
  readRawConfig,
  writeRawConfig,
  addRoot,
  updateRoot,
  removeRoot,
  rootsForClient,
} = require('../lib/configStore');

const router = express.Router();

function statusOf(err) {
  return err.status || 500;
}

// Persist a mutated raw config, then refresh the in-memory cache and drop
// pooled remote connections so the change takes effect immediately.
function persist(raw) {
  writeRawConfig(raw);
  reloadConfig();
  resetRemote();
}

// POST /api/config/reload  — re-read config.json from disk and update the cache.
// Also drops cached remote connections so edits to remote roots take effect
// without a restart.
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
        path: r.type === 'remote' ? `${r.host}:${r.remotePath}` : r.path,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config/settings — runtime settings the client needs at startup.
// Currently just the read-only flag; never includes sensitive data.
router.get('/settings', (req, res) => {
  try {
    const raw = readRawConfig();
    res.json({ readOnly: raw.readOnly === true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config/roots — password-free view of the configured roots, for the
// config-editing UI. Remote roots expose only `hasPassword`, never plaintext.
router.get('/roots', (req, res) => {
  try {
    const raw = readRawConfig();
    res.json({ roots: rootsForClient(raw) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/roots — add a new root. Body is a single root input.
router.post('/roots', (req, res) => {
  try {
    const raw = readRawConfig();
    addRoot(raw, req.body || {});
    persist(raw);
    res.json({ ok: true, roots: rootsForClient(raw) });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err.message });
  }
});

// PUT /api/config/roots/:id — edit an existing root (password sentinel applies).
router.put('/roots/:id', (req, res) => {
  try {
    const raw = readRawConfig();
    updateRoot(raw, req.params.id, req.body || {});
    persist(raw);
    res.json({ ok: true, roots: rootsForClient(raw) });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err.message });
  }
});

// DELETE /api/config/roots/:id — remove a root.
router.delete('/roots/:id', (req, res) => {
  try {
    const raw = readRawConfig();
    removeRoot(raw, req.params.id);
    persist(raw);
    res.json({ ok: true, roots: rootsForClient(raw) });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err.message });
  }
});

module.exports = router;
