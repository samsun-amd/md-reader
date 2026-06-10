const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

function expandHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

// Derive a stable id from a root's name when none is given. Lowercase slug;
// falls back to the index-based id the caller passes in.
function slugId(name, fallback) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

// Normalize a raw config root into a consistent shape:
//   local:  { id, name, type:'local', path }
//   remote: { id, name, type:'remote', host, machineName, port, user, password, os, remotePath }
// Back-compat: a bare { name, path } with no type is treated as local.
// Remote connection details are self-contained in config.json (host/user/...);
// no external inventory is consulted.
function normalizeRoot(raw, index) {
  const type = raw.type || 'local';
  const id = raw.id || slugId(raw.name, `root${index + 1}`);
  if (type === 'remote') {
    return {
      id,
      name: raw.name || raw.host || id,
      type: 'remote',
      host: raw.host,
      // Optional friendly label for the machine sub-tab; the sidebar falls back
      // to host when empty. Connection/grouping still keys on host.
      machineName: raw.machineName || '',
      port: raw.port && raw.port > 0 ? raw.port : 22,
      user: raw.user,
      password: raw.password,
      os: raw.os === 'windows' ? 'windows' : 'posix',
      remotePath: raw.remotePath || '~',
    };
  }
  return {
    id,
    name: raw.name || id,
    type: 'local',
    path: expandHome(raw.path),
  };
}

// Validate a list of normalized roots: unique ids and required remote fields.
// Shared by startup config loading and the config-editing API so both enforce
// the same rules. Throws on the first problem with a user-facing message.
function validateRoots(roots) {
  const seen = new Set();
  for (const r of roots) {
    if (!r.id) throw new Error('Every root needs an id');
    if (seen.has(r.id)) {
      throw new Error(`Duplicate root id "${r.id}" in config.json (ids must be unique)`);
    }
    seen.add(r.id);
    if (r.type === 'remote') {
      if (!r.host) throw new Error(`Remote root "${r.id}" is missing required field "host"`);
      if (!r.user) throw new Error(`Remote root "${r.id}" is missing required field "user"`);
    }
  }
}

function readConfigFromDisk() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.roots = (cfg.roots || []).map((r, i) => normalizeRoot(r, i));
  validateRoots(cfg.roots);
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

function rootById(config, id) {
  return config.roots.find((r) => r.id === id) || null;
}

// --- token codec ---------------------------------------------------------
// A token carries the owning root's identity so a route can tell which machine
// (and which backend) a path belongs to. Client treats it as an opaque string.
//   local:<id>::<absolutePath>
//   remote:<id>::<remotePosixPath>
const TOKEN_SEP = '::';

function encodeToken(root, innerPath) {
  return `${root.type}:${root.id}${TOKEN_SEP}${innerPath}`;
}

function badToken(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function parseToken(token) {
  if (typeof token !== 'string') throw badToken('Invalid token');
  const sepIdx = token.indexOf(TOKEN_SEP);
  if (sepIdx < 0) throw badToken('Malformed token (missing separator)');
  const head = token.slice(0, sepIdx);
  const innerPath = token.slice(sepIdx + TOKEN_SEP.length);
  const colon = head.indexOf(':');
  if (colon < 0) throw badToken('Malformed token (missing type)');
  const type = head.slice(0, colon);
  const id = head.slice(colon + 1);
  if ((type !== 'local' && type !== 'remote') || !id) {
    throw badToken('Malformed token (bad type or id)');
  }
  return { type, id, innerPath };
}

// Resolve a token to its owning root, validating the type matches. Unknown root
// => 404; type mismatch => 400. Callers surface err.status.
function resolveToken(config, token) {
  const { type, id, innerPath } = parseToken(token);
  const root = rootById(config, id);
  if (!root) { const e = new Error(`Unknown root id "${id}"`); e.status = 404; throw e; }
  if (root.type !== type) throw badToken(`Token type "${type}" does not match root "${id}"`);
  return { root, innerPath };
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

// Local-root boundary check. Accepts the resolved local roots only.
function isUnderRoot(targetPath, roots) {
  const resolved = realpathBestEffort(targetPath);
  return roots.some((root) => {
    if (root.type && root.type !== 'local') return false;
    const rootResolved = realpathBestEffort(root.path);
    return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  });
}

// Confirm a resolved local path sits under one specific local root.
function isUnderSpecificRoot(targetPath, root) {
  const resolved = realpathBestEffort(targetPath);
  const rootResolved = realpathBestEffort(root.path);
  return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
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

// Attach an HTTP status to a thrown filesystem error (in place) so routes can
// report the real cause (404/403/...) instead of a blanket 500. Returns the
// same error for convenient re-throwing. Existing err.status wins.
function withFsStatus(err) {
  if (err && err.status == null) err.status = fsErrorStatus(err);
  return err;
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

module.exports = {
  CONFIG_PATH,
  expandHome,
  loadConfig,
  reloadConfig,
  normalizeRoot,
  validateRoots,
  rootById,
  isUnderRoot,
  isUnderSpecificRoot,
  uniqueName,
  fsErrorStatus,
  withFsStatus,
  encodeToken,
  parseToken,
  resolveToken,
};
