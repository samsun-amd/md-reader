const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
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

function isUnderRoot(targetPath, roots) {
  const resolved = path.resolve(targetPath);
  return roots.some((root) => {
    const rootResolved = path.resolve(root.path);
    return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  });
}

function uniqueName(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let n = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 50 },
});

router.post('/', upload.array('files'), (req, res) => {
  const folder = req.body.folder;
  if (!folder) return res.status(400).json({ error: 'folder is required' });
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'no files uploaded' });
  }

  let config;
  try { config = loadConfig(); }
  catch (e) { return res.status(500).json({ error: `config: ${e.message}` }); }

  const target = path.resolve(folder);
  if (!isUnderRoot(target, config.roots)) {
    return res.status(403).json({ error: 'Target folder is outside configured roots' });
  }

  let stat;
  try { stat = fs.statSync(target); }
  catch { return res.status(404).json({ error: 'Target folder not found' }); }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Target is not a directory' });
  }

  const written = [];
  const skipped = [];

  for (const file of req.files) {
    const original = path.basename(file.originalname); // strip any path
    if (!/\.(md|mdx)$/i.test(original)) {
      skipped.push({ name: original, reason: 'not a .md/.mdx file' });
      continue;
    }
    const finalName = uniqueName(target, original);
    const destPath = path.join(target, finalName);
    try {
      fs.writeFileSync(destPath, file.buffer);
      written.push({ original, savedAs: finalName, path: destPath });
    } catch (e) {
      skipped.push({ name: original, reason: e.message });
    }
  }

  res.json({ written, skipped });
});

router.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

module.exports = router;
