const fs = require('fs');
const os = require('os');
const path = require('path');

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

module.exports = { expandHome, loadConfig, isUnderRoot, uniqueName };
