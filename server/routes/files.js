const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig, isUnderRoot, uniqueName } = require('../lib/paths');

const router = express.Router();

function buildTree(dirPath, rootPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = buildTree(fullPath, rootPath);
      // Keep empty dirs so the UI can create files into them
      result.push({ name: entry.name, path: fullPath, type: 'dir', children });
    } else if (/\.(md|mdx)$/i.test(entry.name)) {
      result.push({ name: entry.name, path: fullPath, type: 'file' });
    }
  }

  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

router.get('/', (req, res) => {
  try {
    const config = loadConfig();
    const tree = config.roots.map((root) => ({
      name: root.name,
      path: root.path,
      type: 'root',
      children: buildTree(root.path, root.path),
    }));
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function ensureMdName(name) {
  if (!/\.(md|mdx)$/i.test(name)) return `${name}.md`;
  return name;
}

function validName(name) {
  return name.length > 0
    && name.length < 200
    && !name.includes('/')
    && !name.includes('\\')
    && !name.startsWith('.');
}

// POST /api/files/new   body: { folder, name }
router.post('/new', (req, res) => {
  const { folder, name } = req.body || {};
  if (!folder || !name) return res.status(400).json({ error: 'folder and name required' });

  const safeName = ensureMdName(path.basename(name));
  if (!validName(safeName)) return res.status(400).json({ error: 'Invalid name' });

  let config;
  try { config = loadConfig(); } catch (e) { return res.status(500).json({ error: e.message }); }

  const target = path.resolve(folder);
  if (!isUnderRoot(target, config.roots)) {
    return res.status(403).json({ error: 'Folder outside configured roots' });
  }

  let stat;
  try { stat = fs.statSync(target); } catch { return res.status(404).json({ error: 'Folder not found' }); }
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  const finalName = uniqueName(target, safeName);
  const destPath = path.join(target, finalName);
  try {
    fs.writeFileSync(destPath, '', { flag: 'wx' });
    res.json({ path: destPath, name: finalName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/files/rename   body: { path, newName }
router.post('/rename', (req, res) => {
  const { path: oldPath, newName } = req.body || {};
  if (!oldPath || !newName) return res.status(400).json({ error: 'path and newName required' });

  const safeName = ensureMdName(path.basename(newName));
  if (!validName(safeName)) return res.status(400).json({ error: 'Invalid name' });

  let config;
  try { config = loadConfig(); } catch (e) { return res.status(500).json({ error: e.message }); }

  const resolved = path.resolve(oldPath);
  if (!isUnderRoot(resolved, config.roots)) {
    return res.status(403).json({ error: 'Path outside configured roots' });
  }

  let stat;
  try { stat = fs.statSync(resolved); } catch { return res.status(404).json({ error: 'File not found' }); }
  if (!stat.isFile()) return res.status(400).json({ error: 'Only files can be renamed' });

  const dir = path.dirname(resolved);
  const dest = path.join(dir, safeName);
  if (fs.existsSync(dest) && path.resolve(dest) !== resolved) {
    return res.status(409).json({ error: 'A file with that name already exists' });
  }

  try {
    fs.renameSync(resolved, dest);
    res.json({ path: dest, name: safeName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/files?path=...   (files only, .md/.mdx only)
router.delete('/', (req, res) => {
  const target = req.query.path;
  if (!target) return res.status(400).json({ error: 'path is required' });

  let config;
  try { config = loadConfig(); } catch (e) { return res.status(500).json({ error: e.message }); }

  const resolved = path.resolve(target);
  if (!isUnderRoot(resolved, config.roots)) {
    return res.status(403).json({ error: 'Path outside configured roots' });
  }

  let stat;
  try { stat = fs.statSync(resolved); } catch { return res.status(404).json({ error: 'File not found' }); }
  if (!stat.isFile()) return res.status(400).json({ error: 'Only files can be deleted' });
  if (!/\.(md|mdx)$/i.test(resolved)) {
    return res.status(400).json({ error: 'Only .md/.mdx files can be deleted' });
  }

  try {
    fs.unlinkSync(resolved);
    res.json({ ok: true, path: resolved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
