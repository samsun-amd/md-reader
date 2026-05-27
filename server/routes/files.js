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
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const children = buildTree(fullPath, rootPath);
      if (children.length > 0) {
        result.push({ name: entry.name, path: fullPath, type: 'dir', children });
      }
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

module.exports = router;
