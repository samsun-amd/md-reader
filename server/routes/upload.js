const express = require('express');
const multer = require('multer');
const { loadConfig, resolveToken } = require('../lib/paths');
const { backendFor } = require('../lib/backend');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 50 },
});

function statusOf(err) {
  return err.status || 500;
}

// POST /api/upload   form: { folder: <token>, files: [...] }
router.post('/', upload.array('files'), async (req, res) => {
  const folder = req.body.folder;
  if (!folder) return res.status(400).json({ error: 'folder is required' });
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'no files uploaded' });
  }

  let root;
  let innerPath;
  try {
    const config = loadConfig();
    ({ root, innerPath } = resolveToken(config, folder));
  } catch (e) {
    return res.status(statusOf(e)).json({ error: e.message });
  }

  const backend = backendFor(root);
  const written = [];
  const skipped = [];

  for (const file of req.files) {
    const original = file.originalname.replace(/^.*[\\/]/, ''); // strip any path
    if (!/\.(md|mdx)$/i.test(original)) {
      skipped.push({ name: original, reason: 'not a .md/.mdx file' });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await backend.writeUpload(root, innerPath, original, file.buffer);
      written.push({ original, savedAs: out.savedAs, path: out.token });
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
