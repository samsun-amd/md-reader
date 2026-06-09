const express = require('express');
const { loadConfig, resolveToken } = require('../lib/paths');
const { backendFor } = require('../lib/backend');

const router = express.Router();

function statusOf(err) {
  return err.status || 500;
}

function validName(name) {
  return name.length > 0
    && name.length < 200
    && !name.includes('/')
    && !name.includes('\\')
    && !name.startsWith('.');
}

// GET /api/files — build the tree for every root via its backend. A failing
// remote root reports an error node instead of sinking the whole response.
router.get('/', async (req, res) => {
  let config;
  try { config = loadConfig(); } catch (e) { return res.status(500).json({ error: e.message }); }

  const trees = await Promise.all(config.roots.map(async (root) => {
    try {
      return await backendFor(root).listTree(root);
    } catch (e) {
      return {
        name: root.name,
        path: `error:${root.id}`,
        type: 'root',
        error: e.message,
        children: [],
      };
    }
  }));
  res.json(trees);
});

// POST /api/files/new   body: { folder, name }   (folder is a token)
router.post('/new', async (req, res) => {
  const { folder, name } = req.body || {};
  if (!folder || !name) return res.status(400).json({ error: 'folder and name required' });
  if (!validName(name.replace(/\.(md|mdx)$/i, ''))) {
    return res.status(400).json({ error: 'Invalid name' });
  }

  try {
    const config = loadConfig();
    const { root, innerPath } = resolveToken(config, folder);
    const out = await backendFor(root).createFile(root, innerPath, name);
    res.json({ path: out.token, name: out.name });
  } catch (e) {
    res.status(statusOf(e)).json({ error: e.message });
  }
});

// POST /api/files/rename   body: { path, newName }   (path is a token)
router.post('/rename', async (req, res) => {
  const { path: token, newName } = req.body || {};
  if (!token || !newName) return res.status(400).json({ error: 'path and newName required' });
  if (!validName(newName.replace(/\.(md|mdx)$/i, ''))) {
    return res.status(400).json({ error: 'Invalid name' });
  }

  try {
    const config = loadConfig();
    const { root, innerPath } = resolveToken(config, token);
    const out = await backendFor(root).rename(root, innerPath, newName);
    res.json({ path: out.token, name: out.name });
  } catch (e) {
    res.status(statusOf(e)).json({ error: e.message });
  }
});

// DELETE /api/files?path=<token>
router.delete('/', async (req, res) => {
  const token = req.query.path;
  if (!token) return res.status(400).json({ error: 'path is required' });

  try {
    const config = loadConfig();
    const { root, innerPath } = resolveToken(config, token);
    await backendFor(root).remove(root, innerPath);
    res.json({ ok: true, path: token });
  } catch (e) {
    res.status(statusOf(e)).json({ error: e.message });
  }
});

module.exports = router;
