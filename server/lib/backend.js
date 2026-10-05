const fs = require('fs');
const path = require('path');
const {
  encodeToken,
  uniqueName,
  isUnderSpecificRoot,
  withFsStatus,
  safeRelPath,
} = require('./paths');

const MD_RE = /\.(md|mdx)$/i;

function ensureMdName(name) {
  return MD_RE.test(name) ? name : `${name}.md`;
}

// Directories before files, then locale name.
function sortNodes(nodes) {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// A backend turns root-scoped operations into concrete reads/writes. Each
// returned tree node's `path` is an opaque token (see paths.js) so routes never
// need to know which machine a node lives on.
class Backend {
  /* eslint-disable no-unused-vars, class-methods-use-this */
  async listTree(root) { throw new Error('not implemented'); }
  async readFile(root, token) { throw new Error('not implemented'); }
  async writeFile(root, token, content) { throw new Error('not implemented'); }
  async createFile(root, folderToken, name) { throw new Error('not implemented'); }
  async writeUpload(root, folderToken, filename, buffer) { throw new Error('not implemented'); }
  async rename(root, token, newName) { throw new Error('not implemented'); }
  async remove(root, token) { throw new Error('not implemented'); }
  /* eslint-enable no-unused-vars, class-methods-use-this */
}

// ---------------------------------------------------------------------------
// LocalBackend — the original fs.* logic, now token-aware. innerPath in a local
// token is an absolute filesystem path; we re-validate it against the specific
// root on every call (never trust the client's token).
// ---------------------------------------------------------------------------
class LocalBackend extends Backend {
  async buildTree(dirPath, root) {
    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const result = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: encodeToken(root, full),
          type: 'dir',
          children: await this.buildTree(full, root),
        });
      } else if (MD_RE.test(entry.name)) {
        result.push({ name: entry.name, path: encodeToken(root, full), type: 'file' });
      }
    }
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async listTree(root) {
    return {
      name: root.name,
      path: encodeToken(root, root.path),
      type: 'root',
      children: await this.buildTree(root.path, root),
    };
  }

  resolveInside(root, innerPath) {
    const resolved = path.resolve(innerPath);
    if (!isUnderSpecificRoot(resolved, root)) {
      const err = new Error('Path outside configured root');
      err.status = 403;
      throw err;
    }
    return resolved;
  }

  async readFile(root, innerPath) {
    const resolved = this.resolveInside(root, innerPath);
    if (!MD_RE.test(resolved)) { const e = new Error('Only .md/.mdx files allowed'); e.status = 400; throw e; }
    try {
      return fs.readFileSync(resolved, 'utf8');
    } catch (e) { throw withFsStatus(e); }
  }

  async writeFile(root, innerPath, content) {
    const resolved = this.resolveInside(root, innerPath);
    if (!MD_RE.test(resolved)) { const e = new Error('Only .md/.mdx files allowed'); e.status = 400; throw e; }
    try {
      fs.writeFileSync(resolved, content, 'utf8');
    } catch (e) { throw withFsStatus(e); }
    return { bytes: Buffer.byteLength(content, 'utf8') };
  }

  async createFile(root, folderInner, name) {
    const dir = this.resolveInside(root, folderInner);
    let stat;
    try { stat = fs.statSync(dir); } catch { const e = new Error('Folder not found'); e.status = 404; throw e; }
    if (!stat.isDirectory()) { const e = new Error('Not a directory'); e.status = 400; throw e; }
    const finalName = uniqueName(dir, ensureMdName(path.basename(name)));
    const dest = path.join(dir, finalName);
    try {
      fs.writeFileSync(dest, '', { flag: 'wx' });
    } catch (e) { throw withFsStatus(e); }
    return { token: encodeToken(root, dest), name: finalName };
  }

  async writeUpload(root, folderInner, filename, buffer) {
    const dir = this.resolveInside(root, folderInner);
    const finalName = uniqueName(dir, path.basename(filename));
    const dest = path.join(dir, finalName);
    try {
      fs.writeFileSync(dest, buffer);
    } catch (e) { throw withFsStatus(e); }
    return { savedAs: finalName, token: encodeToken(root, dest) };
  }

  async rename(root, innerPath, newName) {
    const resolved = this.resolveInside(root, innerPath);
    let stat;
    try { stat = fs.statSync(resolved); } catch { const e = new Error('File not found'); e.status = 404; throw e; }
    if (!stat.isFile()) { const e = new Error('Only files can be renamed'); e.status = 400; throw e; }
    const safeName = ensureMdName(path.basename(newName));
    const dest = path.join(path.dirname(resolved), safeName);
    if (fs.existsSync(dest) && path.resolve(dest) !== resolved) {
      const e = new Error('A file with that name already exists'); e.status = 409; throw e;
    }
    try {
      fs.renameSync(resolved, dest);
    } catch (e) { throw withFsStatus(e); }
    return { token: encodeToken(root, dest), name: safeName };
  }

  async remove(root, innerPath) {
    const resolved = this.resolveInside(root, innerPath);
    let stat;
    try { stat = fs.statSync(resolved); } catch { const e = new Error('File not found'); e.status = 404; throw e; }
    if (!stat.isFile()) { const e = new Error('Only files can be deleted'); e.status = 400; throw e; }
    if (!MD_RE.test(resolved)) { const e = new Error('Only .md/.mdx files can be deleted'); e.status = 400; throw e; }
    try {
      fs.unlinkSync(resolved);
    } catch (e) { throw withFsStatus(e); }
  }
}

// ---------------------------------------------------------------------------
// SftpBackend — thin wrapper over @ssh-manager/core. core is required lazily so
// a local-only install never needs it present. Connection details are
// self-contained on the root (host/port/user/password/os); no external
// inventory is consulted.
// ---------------------------------------------------------------------------
let corePromise = null;
function loadCore() {
  if (!corePromise) {
    corePromise = Promise.resolve().then(() => require('@ssh-manager/core'));
  }
  return corePromise;
}

// Map an ssh2 SFTP error to an HTTP status (in place). SFTP reports failures
// via numeric status codes (SSH_FX_*) on err.code, not POSIX errno strings, so
// a missing/forbidden remote file would otherwise surface as a blanket 500.
const SFTP_NO_SUCH_FILE = 2;
const SFTP_PERMISSION_DENIED = 3;
function withSftpStatus(err) {
  if (err && err.status == null) {
    const code = err.code;
    if (code === SFTP_NO_SUCH_FILE || /no such file|not found/i.test(err.message || '')) {
      err.status = 404;
    } else if (code === SFTP_PERMISSION_DENIED || /permission denied/i.test(err.message || '')) {
      err.status = 403;
    }
  }
  return err;
}

class SftpBackend extends Backend {
  constructor(shared) {
    super();
    this.shared = shared; // { pool } lazily populated
  }

  async core() {
    return loadCore();
  }

  async endpointFor(root) {
    const core = await this.core();
    if (!this.shared.pool) {
      this.shared.pool = new core.SshPool({ readyTimeoutMs: 15000, idleTimeoutMs: 60000 });
    }
    try {
      return core.adhocEndpoint({
        host: root.host,
        port: root.port,
        user: root.user,
        password: root.password,
        os: root.os,
        label: root.id,
      });
    } catch (e) {
      const err = new Error(`Remote root "${root.id}": ${e.message}`);
      err.status = 400;
      throw err;
    }
  }

  // Run fn with a RemoteFs bound to a pooled session. Connection failures are
  // surfaced as 503 so the sidebar shows an error instead of hanging.
  async withFs(root, fn) {
    const core = await this.core();
    const endpoint = await this.endpointFor(root);
    try {
      return await this.shared.pool.withSession(endpoint, async (session) => {
        const rfs = new core.RemoteFs(session);
        return fn(rfs, core);
      });
    } catch (e) {
      // Don't reclassify an error a backend op already mapped (e.g. a remote
      // 404/403); only genuine connectivity failures become 503.
      if (e && e.status == null
        && (e instanceof core.SshConnectionError
          || /connection|timed out|unreachable|refused|ENOTFOUND/i.test(e.message))) {
        const err = new Error(`Remote "${root.host}" unavailable: ${e.message}`);
        err.status = 503;
        throw err;
      }
      throw e;
    }
  }

  // Validate a remote inner path stays under the root's remotePath (string
  // prefix on the normalized, home-expanded path). Mirrors the local realpath
  // check; defends against ../ escape in a client-supplied token.
  async resolveInside(rfs, root, innerPath) {
    const base = await rfs.expandHome(root.remotePath || '~');
    const target = await rfs.expandHome(innerPath);
    if (!rfs.path.isUnder(base, target)) {
      const err = new Error('Path outside configured remote root');
      err.status = 403;
      throw err;
    }
    return target;
  }

  buildTree(entries, root, rel = '') {
    const out = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.type === 'dir') {
        out.push({
          name: e.name, path: encodeToken(root, e.path), type: 'dir',
          rel: rel ? `${rel}/${e.name}` : e.name, children: null,
        });
      } else if (e.type === 'file' && MD_RE.test(e.name)) {
        out.push({ name: e.name, path: encodeToken(root, e.path), type: 'file' });
      }
    }
    return sortNodes(out);
  }

  // Read only the requested directory. null children means not loaded yet;
  // [] means loaded and empty. Pins use the same path without loading ancestors.
  async listTree(root, rel = '') {
    if (typeof rel !== 'string' || rel.includes('\0')) {
      throw Object.assign(new Error('Invalid directory path'), { status: 400 });
    }
    if (rel) rel = safeRelPath(rel);
    if (rel.split('/').some((part) => part.startsWith('.'))) {
      throw Object.assign(new Error('Hidden directories are not available'), { status: 403 });
    }
    return this.withFs(root, async (rfs) => {
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const base = await rfs.expandHome(root.remotePath || '~');
            const target = rel ? rfs.path.join(base, rel) : base;
            // Resolve symlinks before accepting a client-supplied directory.
            if (rel) {
              let canonical;
              if (rfs.session.sftpAvailable === false) {
                const quoted = "'" + target.replace(/'/g, "'\\''") + "'";
                const result = await rfs.session.exec(`cd ${quoted} && pwd -P`);
                if (result.code !== 0) throw new Error(result.stderr || 'Directory lookup failed');
                canonical = result.stdout.trim();
              } else {
                const sftp = await rfs.session.sftp();
                canonical = await new Promise((resolve, reject) => {
                  sftp.realpath(target, (err, value) => err ? reject(err) : resolve(value));
                });
              }
              if (!rfs.path.isUnder(base, canonical)) {
                throw Object.assign(new Error('Path outside configured remote root'), { status: 403 });
              }
            }
            const entries = await rfs.list(target, { includeHidden: false });
            return {
              name: rel ? rfs.path.basename(target) : root.name,
              path: encodeToken(root, target),
              type: rel ? 'dir' : 'root', rel,
              children: this.buildTree(entries, root, rel),
            };
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(Object.assign(new Error('Directory listing timed out after 15 seconds'), { status: 504 }));
              rfs.session.end();
            }, 15000);
          }),
        ]);
      } catch (e) { throw withSftpStatus(e); }
      finally { clearTimeout(timer); }
    });
  }

  async readFile(root, innerPath) {
    return this.withFs(root, async (rfs) => {
      const target = await this.resolveInside(rfs, root, innerPath);
      if (!MD_RE.test(target)) { const e = new Error('Only .md/.mdx files allowed'); e.status = 400; throw e; }
      try {
        const buf = await rfs.readFile(target);
        return buf.toString('utf8');
      } catch (e) { throw withSftpStatus(e); }
    });
  }

  async writeFile(root, innerPath, content) {
    return this.withFs(root, async (rfs) => {
      const target = await this.resolveInside(rfs, root, innerPath);
      if (!MD_RE.test(target)) { const e = new Error('Only .md/.mdx files allowed'); e.status = 400; throw e; }
      try {
        await rfs.writeFile(target, content);
      } catch (e) { throw withSftpStatus(e); }
      return { bytes: Buffer.byteLength(content, 'utf8') };
    });
  }

  async uniqueRemoteName(rfs, dir, filename) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let candidate = filename;
    // Bound the loop so a stat that fails for a reason *other* than
    // "not found" (e.g. permission denied) can never spin forever; we still
    // re-throw such errors rather than silently overwriting.
    for (let n = 2; n < 10000; n += 1) {
      let exists = true;
      try {
        // eslint-disable-next-line no-await-in-loop
        await rfs.stat(rfs.path.join(dir, candidate));
      } catch (e) {
        // A "no such file" means the name is free; anything else is a real error.
        if (e && e.code !== SFTP_NO_SUCH_FILE && !/no such file|not found/i.test(e.message || '')) {
          throw withSftpStatus(e);
        }
        exists = false;
      }
      if (!exists) return candidate;
      candidate = `${base} (${n})${ext}`;
    }
    const err = new Error('Could not find a free filename');
    err.status = 409;
    throw err;
  }

  async createFile(root, folderInner, name) {
    return this.withFs(root, async (rfs) => {
      const dir = await this.resolveInside(rfs, root, folderInner);
      const finalName = await this.uniqueRemoteName(rfs, dir, ensureMdName(path.basename(name)));
      const dest = rfs.path.join(dir, finalName);
      try {
        await rfs.writeFile(dest, '');
      } catch (e) { throw withSftpStatus(e); }
      return { token: encodeToken(root, dest), name: finalName };
    });
  }

  async writeUpload(root, folderInner, filename, buffer) {
    return this.withFs(root, async (rfs) => {
      const dir = await this.resolveInside(rfs, root, folderInner);
      const finalName = await this.uniqueRemoteName(rfs, dir, path.basename(filename));
      const dest = rfs.path.join(dir, finalName);
      try {
        await rfs.writeFile(dest, buffer);
      } catch (e) { throw withSftpStatus(e); }
      return { savedAs: finalName, token: encodeToken(root, dest) };
    });
  }

  async rename(root, innerPath, newName) {
    return this.withFs(root, async (rfs) => {
      const target = await this.resolveInside(rfs, root, innerPath);
      const safeName = ensureMdName(path.basename(newName));
      const dest = rfs.path.join(rfs.path.dirname(target), safeName);
      try {
        await rfs.rename(target, dest);
      } catch (e) { throw withSftpStatus(e); }
      return { token: encodeToken(root, dest), name: safeName };
    });
  }

  async remove(root, innerPath) {
    return this.withFs(root, async (rfs) => {
      const target = await this.resolveInside(rfs, root, innerPath);
      if (!MD_RE.test(target)) { const e = new Error('Only .md/.mdx files can be deleted'); e.status = 400; throw e; }
      try {
        await rfs.remove(target);
      } catch (e) { throw withSftpStatus(e); }
    });
  }
}

// Shared state for remote backends (one pool process-wide).
const sharedRemote = { pool: null };
const localBackend = new LocalBackend();
const sftpBackend = new SftpBackend(sharedRemote);

function backendFor(root) {
  return root.type === 'remote' ? sftpBackend : localBackend;
}

// Drop the cached pool so /api/config/reload picks up edits and frees remote
// connections.
function resetRemote() {
  if (sharedRemote.pool) {
    try { sharedRemote.pool.closeAll(); } catch { /* ignore */ }
  }
  sharedRemote.pool = null;
}

module.exports = { Backend, LocalBackend, SftpBackend, backendFor, resetRemote };
