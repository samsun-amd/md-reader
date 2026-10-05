const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

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

// A remote root is always rooted at the remote home directory. Reaching a
// specific folder is what pins are for, so a root stays "a machine" and nothing
// more. Kept as a named constant because the SFTP backend also needs it as the
// containment base.
const REMOTE_BASE = '~';

// Normalize a raw config root into a consistent shape:
//   local:  { id, name, type:'local', path, pins }
//   remote: { id, name, type:'remote', host, port, user, password, os, pins }
// Back-compat: a bare { name, path } with no type is treated as local.
// Remote connection details are self-contained in config.json (host/user/...);
// no external inventory is consulted.
// `pins` holds folder paths RELATIVE to the root's base, e.g. "md/notes".
function normalizeRoot(raw, index) {
  const type = raw.type || 'local';
  const id = raw.id || slugId(raw.name, `root${index + 1}`);
  const pins = Array.isArray(raw.pins)
    ? raw.pins.filter((p) => typeof p === 'string' && p)
    : [];
  if (type === 'remote') {
    return {
      id,
      name: raw.name || raw.host || id,
      type: 'remote',
      host: raw.host,
      port: raw.port && raw.port > 0 ? raw.port : 22,
      user: raw.user,
      password: raw.password,
      os: raw.os === 'windows' ? 'windows' : 'posix',
      remotePath: REMOTE_BASE,
      pins,
    };
  }
  return {
    id,
    name: raw.name || id,
    type: 'local',
    path: expandHome(raw.path),
    pins,
  };
}

// Warn about raw config keys that used to change behavior and are now ignored.
// A stale machineName is cosmetic, but a remotePath other than '~' means the
// user was looking at a subfolder and will silently land on the home dir
// instead — so name the root and say where that folder went.
function warnLegacyRootFields(rawRoots) {
  for (const raw of rawRoots || []) {
    if ((raw.type || 'local') !== 'remote') continue;
    const who = raw.id || raw.host || '(unnamed)';
    if (raw.remotePath && raw.remotePath !== REMOTE_BASE) {
      console.warn(
        `[config] Remote root "${who}": "remotePath": ${JSON.stringify(raw.remotePath)} is no `
        + 'longer supported and is ignored — remote roots always open at "~". Pin that folder '
        + 'instead (⋯ menu on any folder row).',
      );
    }
    if (raw.machineName) {
      console.warn(
        `[config] Remote root "${who}": "machineName" is no longer used; the sub-tab is `
        + 'labelled with "name".',
      );
    }
  }
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

// A pin is stored relative to its root's base, so "safe" is a pure string
// property: no absolute paths, no '..' escape, no empty/'.' segments. Checking
// it here means pinning never needs to contact the remote (a pin can be added
// or removed while the machine is offline), and every actual read still goes
// through the backend's own containment check independently.
function safeRelPath(value) {
  const rel = String(value == null ? '' : value).trim().replace(/\\/g, '/');
  if (!rel) throw badRequest('Pin path is required');
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
    throw badRequest('Pin path must be relative to the root');
  }
  const parts = rel.split('/').filter((p) => p !== '');
  if (!parts.length || parts.some((p) => p === '.' || p === '..')) {
    throw badRequest('Pin path must not contain "." or ".." segments');
  }
  return parts.join('/');
}

// Reject a malformed `pins` before it reaches disk. normalizeRoot silently
// filters junk out of its own view, so this checks the RAW value — otherwise a
// bad write would be accepted and then quietly ignored on read.
function validateRawPins(rawRoots) {
  for (const raw of rawRoots || []) {
    if (raw.pins === undefined) continue;
    if (!Array.isArray(raw.pins) || raw.pins.some((p) => typeof p !== 'string')) {
      throw new Error(`Root "${raw.id}": "pins" must be an array of strings`);
    }
  }
}

function readConfigFromDisk() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const rawRoots = cfg.roots || [];
  warnLegacyRootFields(rawRoots);
  cfg.roots = rawRoots.map((r, i) => normalizeRoot(r, i));
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

// Only genuinely missing entries may be appended to a resolved ancestor.
// lstat sees dangling symlinks; realpath must resolve every existing entry.
function realpathBestEffort(target) {
  let current = path.resolve(target);
  const tail = [];
  // Bound the loop by path depth to avoid any pathological spinning.
  for (let i = 0; i < 4096; i += 1) {
    try {
      if (fs.lstatSync(current, { throwIfNoEntry: false })) {
        return path.join(fs.realpathSync(current), ...tail.reverse());
      }
    } catch (e) { throw Object.assign(e, { status: 403 }); }
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.push(path.basename(current));
    current = parent;
  }
  throw Object.assign(new Error('Cannot safely resolve path'), { status: 403 });
}

// Local-root boundary check. Accepts the resolved local roots only.
function isUnderRoot(targetPath, roots) {
  return roots.some((root) => (!root.type || root.type === 'local') && isUnderSpecificRoot(targetPath, root));
}

// Confirm a resolved local path sits under one specific local root.
function isUnderSpecificRoot(targetPath, root) {
  const resolved = realpathBestEffort(targetPath);
  let rootResolved;
  try { rootResolved = fs.realpathSync(root.path); }
  catch (e) { throw Object.assign(e, { status: 403 }); }
  const relative = path.relative(rootResolved, resolved);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Map a Node fs error to an HTTP status code so routes can report the real
// cause (not found vs. permission vs. is-a-directory) instead of a blanket 404.
function fsErrorStatus(err) {
  switch (err && err.code) {
    case 'ENOENT': return 404;
    case 'EACCES':
    case 'EPERM':
    case 'ELOOP': return 403;
    case 'EEXIST': return 409;
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

function entryExists(target) {
  try { return !!fs.lstatSync(target, { throwIfNoEntry: false }); }
  catch (e) { throw withFsStatus(e); }
}

function uniqueName(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let n = 2;
  while (entryExists(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

module.exports = {
  CONFIG_PATH,
  REMOTE_BASE,
  expandHome,
  slugId,
  loadConfig,
  reloadConfig,
  normalizeRoot,
  validateRoots,
  validateRawPins,
  safeRelPath,
  rootById,
  realpathBestEffort,
  isUnderRoot,
  isUnderSpecificRoot,
  uniqueName,
  entryExists,
  fsErrorStatus,
  withFsStatus,
  encodeToken,
  parseToken,
  resolveToken,
};
