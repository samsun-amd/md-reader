const fs = require('fs');
const { CONFIG_PATH, normalizeRoot, validateRoots } = require('./paths');

// configStore centralizes reading/writing config.json for the editing API.
// Unlike paths.loadConfig (which returns a NORMALIZED, cached view), this layer
// works on the RAW on-disk shape so top-level fields (allowRemoteAccess, port,
// clientPort) and the raw root form (local: path, remote: inline fields) are
// preserved verbatim across edits.

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function readRawConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!Array.isArray(cfg.roots)) cfg.roots = [];
  return cfg;
}

// Atomic write: serialize, write to a sibling temp file, then rename over the
// target so a crash mid-write can never leave a truncated config.json.
function writeRawConfig(cfg) {
  // Validate using the same rules as startup, on the normalized projection.
  validateRoots((cfg.roots || []).map((r, i) => normalizeRoot(r, i)));
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  return cfg;
}

// Build the raw stored form of a root from a client input object. Only the
// fields relevant to the type are kept; unknown fields are dropped. Password
// handling (sentinel) is resolved by the caller and passed in via `password`.
function toStoredRoot(input, resolvedPassword) {
  const id = String(input.id || '').trim();
  const type = input.type === 'remote' ? 'remote' : 'local';
  const name = (input.name && String(input.name).trim()) || id;
  if (type === 'remote') {
    const root = {
      id,
      name,
      type: 'remote',
      host: input.host ? String(input.host).trim() : '',
      port: input.port && Number(input.port) > 0 ? Number(input.port) : 22,
      user: input.user ? String(input.user).trim() : '',
      os: input.os === 'windows' ? 'windows' : 'posix',
      remotePath: (input.remotePath && String(input.remotePath).trim()) || '~',
    };
    // Only persist a password when one is actually set (non-empty).
    if (resolvedPassword) root.password = resolvedPassword;
    return root;
  }
  return {
    id,
    name,
    type: 'local',
    path: input.path ? String(input.path).trim() : '',
  };
}

function findIndexById(roots, id) {
  return roots.findIndex((r) => r.id === id);
}

// Add a new root. Rejects duplicate id up front for a clearer message than the
// generic validateRoots pass (which also catches it).
function addRoot(raw, input) {
  const id = String(input.id || '').trim();
  if (!id) throw badRequest('Root id is required');
  if (findIndexById(raw.roots, id) >= 0) throw badRequest(`Root id "${id}" already exists`);
  // New root: password sentinel doesn't apply — take whatever was sent.
  const password = typeof input.password === 'string' ? input.password : '';
  raw.roots.push(toStoredRoot({ ...input, id }, password));
  return raw;
}

// Update an existing root. Password sentinel:
//   - input.password undefined        -> keep the existing stored password
//   - input.password === ''           -> clear the password
//   - input.password non-empty string -> set the new password
function updateRoot(raw, id, input) {
  const idx = findIndexById(raw.roots, id);
  if (idx < 0) { const e = new Error(`Unknown root id "${id}"`); e.status = 404; throw e; }
  const existing = raw.roots[idx];
  let password;
  if (input.password === undefined) {
    password = existing.password || '';
  } else {
    password = String(input.password);
  }
  // id is immutable on edit; force the existing id.
  raw.roots[idx] = toStoredRoot({ ...input, id, type: input.type || existing.type }, password);
  return raw;
}

function removeRoot(raw, id) {
  const idx = findIndexById(raw.roots, id);
  if (idx < 0) { const e = new Error(`Unknown root id "${id}"`); e.status = 404; throw e; }
  raw.roots.splice(idx, 1);
  return raw;
}

// Project the raw roots into a password-free view for the client. Remote roots
// expose only hasPassword, never the plaintext.
function rootsForClient(raw) {
  return (raw.roots || []).map((r) => {
    if (r.type === 'remote') {
      return {
        id: r.id,
        name: r.name || r.host || r.id,
        type: 'remote',
        host: r.host || '',
        port: r.port && Number(r.port) > 0 ? Number(r.port) : 22,
        user: r.user || '',
        os: r.os === 'windows' ? 'windows' : 'posix',
        remotePath: r.remotePath || '~',
        hasPassword: Boolean(r.password),
      };
    }
    return {
      id: r.id,
      name: r.name || r.id,
      type: 'local',
      path: r.path || '',
    };
  });
}

module.exports = {
  readRawConfig,
  writeRawConfig,
  addRoot,
  updateRoot,
  removeRoot,
  rootsForClient,
};
