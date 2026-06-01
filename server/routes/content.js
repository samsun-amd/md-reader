const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig, isUnderRoot, fsErrorStatus } = require('../lib/paths');

const router = express.Router();

router.get('/', (req, res) => {
  const { path: reqPath } = req.query;
  if (!reqPath) return res.status(400).json({ error: 'path is required' });

  try {
    const config = loadConfig();
    const resolved = path.resolve(reqPath);

    if (!isUnderRoot(resolved, config.roots)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!/\.(md|mdx)$/i.test(resolved)) {
      return res.status(400).json({ error: 'Only .md/.mdx files allowed' });
    }

    const content = fs.readFileSync(resolved, 'utf8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(fsErrorStatus(err)).json({ error: err.message });
  }
});

// PUT /api/content   body: { path, content }
router.put('/', (req, res) => {
  const { path: reqPath, content } = req.body || {};
  if (!reqPath || typeof content !== 'string') {
    return res.status(400).json({ error: 'path and content required' });
  }

  try {
    const config = loadConfig();
    const resolved = path.resolve(reqPath);

    if (!isUnderRoot(resolved, config.roots)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!/\.(md|mdx)$/i.test(resolved)) {
      return res.status(400).json({ error: 'Only .md/.mdx files allowed' });
    }

    fs.writeFileSync(resolved, content, 'utf8');
    res.json({ ok: true, path: resolved, bytes: Buffer.byteLength(content, 'utf8') });
  } catch (err) {
    res.status(fsErrorStatus(err)).json({ error: err.message });
  }
});

module.exports = router;
