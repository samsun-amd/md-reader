const express = require('express');
const { loadConfig, resolveToken } = require('../lib/paths');
const { backendFor } = require('../lib/backend');

const router = express.Router();

function statusOf(err) {
  return err.status || 500;
}

// GET /api/content?path=<token>
router.get('/', async (req, res) => {
  const token = req.query.path;
  if (!token) return res.status(400).json({ error: 'path is required' });

  try {
    const config = loadConfig();
    const { root, innerPath } = resolveToken(config, token);
    const content = await backendFor(root).readFile(root, innerPath);
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(statusOf(err)).json({ error: err.message });
  }
});

// PUT /api/content   body: { path, content }   (path is a token)
router.put('/', async (req, res) => {
  const { path: token, content } = req.body || {};
  if (!token || typeof content !== 'string') {
    return res.status(400).json({ error: 'path and content required' });
  }

  try {
    const config = loadConfig();
    const { root, innerPath } = resolveToken(config, token);
    const out = await backendFor(root).writeFile(root, innerPath, content);
    res.json({ ok: true, path: token, bytes: out.bytes });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err.message });
  }
});

module.exports = router;
