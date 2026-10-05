const express = require('express');
const { loadConfig, rootById, resolveToken } = require('../lib/paths');
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

// GET /api/files/roots — root metadata only, no tree walking. Lets the client
// build the tab/sub-tab structure instantly without touching any remote.
router.get('/roots', (req, res) => {
  let config;
  try { config = loadConfig(); } catch (e) { return res.status(500).json({ error: e.message }); }
  // Never expose remote credentials (password) to the client. `pins` ships here
  // so the sidebar can render the pinned block without a second request.
  res.json(config.roots.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    host: r.host || null,
    pins: r.pins || [],
  })));
});

// GET /api/files/root/:id?rel=notes — local tree or one remote directory.
router.get('/root/:id', async (req, res) => {
  const started = Date.now();
  let config;
  try { config = loadConfig(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const root = rootById(config, req.params.id);
  if (!root) return res.status(404).json({ error: `Unknown root id "${req.params.id}"` });
  try {
    if (req.query.rel !== undefined && (typeof req.query.rel !== 'string' || root.type !== 'remote')) {
      return res.status(400).json({ error: 'rel must be a string for a remote root' });
    }
    const tree = await backendFor(root).listTree(root, req.query.rel);
    res.json(tree);
  } catch (e) {
    res.status(statusOf(e)).json({ error: e.message });
  } finally {
    if (root.type === 'remote') {
      console.log('[remote-list]', JSON.stringify({
        root: root.id, rel: req.query.rel || '', status: res.statusCode, ms: Date.now() - started,
      }));
    }
  }
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
