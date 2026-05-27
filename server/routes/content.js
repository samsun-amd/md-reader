const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const router = express.Router();

function expandHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function loadConfig() {
  const cfgPath = path.join(__dirname, '../../config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.roots = cfg.roots.map((r) => ({ ...r, path: expandHome(r.path) }));
  return cfg;
}

function isUnderRoot(filePath, roots) {
  const resolved = path.resolve(filePath);
  return roots.some((root) => resolved.startsWith(path.resolve(root.path) + path.sep) ||
    resolved === path.resolve(root.path));
}

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
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
