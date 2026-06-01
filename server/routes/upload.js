const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { loadConfig, isUnderRoot, uniqueName } = require('../lib/paths');

const router = express.Router();

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
