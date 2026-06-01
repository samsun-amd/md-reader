const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

function expandHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function readConfigFromDisk() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.roots = cfg.roots.map((r) => ({ ...r, path: expandHome(r.path) }));
  return cfg;
}

let cachedConfig = null;

// Returns the cached config, reading from disk on first access. Use
// reloadConfig() to pick up edits to config.json without restarting.
function loadConfig() {
  if (!cachedConfig) cachedConfig = readConfigFromDisk();
  return cachedConfig;
}

function reloadConfig() {
  cachedConfig = readConfigFromDisk();
  return cachedConfig;
}

// Resolve a path to its canonical form, following symlinks where the target
// exists. For not-yet-existing paths (e.g. a file about to be created) the
// deepest existing ancestor is resolved and the remaining segments appended,
// so a symlinked parent directory cannot be used to escape a root.
function realpathBestEffort(target) {
  let current = path.resolve(target);
  const tail = [];
  // Bound the loop by path depth to avoid any pathological spinning.
  for (let i = 0; i < 4096; i += 1) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target); // reached root, nothing resolvable
      tail.push(path.basename(current));
      current = parent;
    }
  }
  return path.resolve(target);
}

function isUnderRoot(targetPath, roots) {
  const resolved = realpathBestEffort(targetPath);
  return roots.some((root) => {
    const rootResolved = realpathBestEffort(root.path);
    return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  });
}

// Map a Node fs error to an HTTP status code so routes can report the real
// cause (not found vs. permission vs. is-a-directory) instead of a blanket 404.
function fsErrorStatus(err) {
  switch (err && err.code) {
    case 'ENOENT': return 404;
    case 'EACCES':
    case 'EPERM': return 403;
    case 'EISDIR':
    case 'ENOTDIR': return 400;
    default: return 500;
  }
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

module.exports = { expandHome, loadConfig, reloadConfig, isUnderRoot, uniqueName, fsErrorStatus };
