const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalBackend, SftpBackend, backendFor, resetRemote } = require('../server/lib/backend');
const { encodeToken, parseToken, resolveToken } = require('../server/lib/paths');

function localFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader QA '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = { id: 'docs', name: 'Docs', type: 'local', path: path.join(dir, 'docs') };
  fs.mkdirSync(root.path);
  return { dir, root, backend: new LocalBackend() };
}

test('local tree keeps frontend tokens, Markdown filtering and directory order', async (t) => {
  const { root, backend } = localFixture(t);
  fs.mkdirSync(path.join(root.path, 'notes'));
  for (const name of ['a.md', 'b.mdx', 'ignored.txt', '.hidden.md', 'notes/nested.md']) {
    fs.writeFileSync(path.join(root.path, name), '# QA');
  }
  const tree = await backend.listTree(root);
  assert.equal(tree.type, 'root');
  assert.equal(tree.path, encodeToken(root, root.path));
  assert.deepEqual(tree.children.map((n) => n.name), ['notes', 'a.md', 'b.mdx']);
  assert.equal(tree.children[0].children[0].path, encodeToken(root, path.join(root.path, 'notes/nested.md')));
});

test('a slow local directory read yields to other work before the tree finishes', async (t) => {
  const { root, backend } = localFixture(t);
  fs.mkdirSync(path.join(root.path, 'notes'));
  fs.writeFileSync(path.join(root.path, 'notes/a.md'), '# QA');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const readdir = fs.promises.readdir;
  t.mock.method(fs.promises, 'readdir', async (...args) => {
    await gate;
    return readdir(...args);
  });
  let finished = false;
  const listing = backend.listTree(root).then((tree) => { finished = true; return tree; });
  await new Promise(setImmediate);
  assert.equal(finished, false, 'directory IO must not block the event loop');
  release();
  const tree = await listing;
  assert.equal(tree.children[0].children[0].name, 'a.md');
});

test('local create, UTF-8 save/read, upload, rename and delete preserve data', async (t) => {
  const { root, backend } = localFixture(t);
  const created = await backend.createFile(root, root.path, 'note');
  assert.equal(created.name, 'note.md');
  const file = parseToken(created.token).innerPath;
  const content = '# QA\n\u6e2c\u8a66';
  assert.deepEqual(await backend.writeFile(root, file, content), { bytes: Buffer.byteLength(content) });
  assert.equal(await backend.readFile(root, file), content);
  assert.equal((await backend.createFile(root, root.path, 'note')).name, 'note (2).md');
  const upload = await backend.writeUpload(root, root.path, 'note.md', Buffer.from('uploaded'));
  assert.equal(upload.savedAs, 'note (3).md');
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.equal(await backend.readFile(root, parseToken(upload.token).innerPath), 'uploaded');
  const renamed = await backend.rename(root, file, 'renamed');
  assert.equal(renamed.name, 'renamed.md');
  assert.equal(fs.existsSync(file), false);
  await backend.remove(root, parseToken(renamed.token).innerPath);
  assert.equal(fs.existsSync(path.join(root.path, 'renamed.md')), false);
});

test('local reads and writes reject sibling paths and symlink escapes', async (t) => {
  const { dir, root, backend } = localFixture(t);
  const outside = path.join(dir, 'docs-other');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.md'), 'untouched');
  fs.symlinkSync(outside, path.join(root.path, 'escape'));
  for (const target of [outside, path.join(root.path, 'escape')]) {
    await assert.rejects(backend.readFile(root, path.join(target, 'keep.md')), { status: 403 });
    await assert.rejects(backend.writeFile(root, path.join(target, 'new.md'), 'bad'), { status: 403 });
    await assert.rejects(backend.createFile(root, target, 'new'), { status: 403 });
    await assert.rejects(backend.writeUpload(root, target, 'new.md', Buffer.from('bad')), { status: 403 });
    await assert.rejects(backend.remove(root, path.join(target, 'keep.md')), { status: 403 });
  }
  assert.deepEqual(fs.readdirSync(outside), ['keep.md']);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.md'), 'utf8'), 'untouched');
});

test('local failures retain 400, 404 and 409 statuses', async (t) => {
  const { root, backend } = localFixture(t);
  await assert.rejects(backend.readFile(root, path.join(root.path, 'missing.md')), { status: 404 });
  await assert.rejects(backend.writeFile(root, path.join(root.path, 'file.txt'), ''), { status: 400 });
  await backend.createFile(root, root.path, 'a');
  await backend.createFile(root, root.path, 'b');
  await assert.rejects(backend.rename(root, path.join(root.path, 'a.md'), 'b'), { status: 409 });
  await assert.rejects(backend.remove(root, root.path), { status: 400 });
});

test('local writes reject dangling links, dangling ancestors and loops without changing targets', async (t) => {
  const { dir, root, backend } = localFixture(t);
  const outside = path.join(dir, 'outside.md');
  const inside = path.join(root.path, 'new.md');
  for (const [name, target] of [['escape.md', outside], ['inside.md', inside]]) {
    const link = path.join(root.path, name);
    fs.symlinkSync(target, link);
    await assert.rejects(backend.writeFile(root, link, 'bad'), { status: 403 });
    await assert.rejects(backend.readFile(root, link), { status: 403 });
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(fs.existsSync(target), false);
  }
  fs.symlinkSync(path.join(dir, 'missing-directory'), path.join(root.path, 'dangling'));
  fs.symlinkSync('loop.md', path.join(root.path, 'loop.md'));
  for (const name of ['dangling/new.md', 'loop.md']) {
    await assert.rejects(backend.writeFile(root, path.join(root.path, name), 'bad'), { status: 403 });
  }
  assert.equal(fs.existsSync(path.join(dir, 'missing-directory')), false);
});

test('local upload never follows an occupied dangling link', async (t) => {
  const { dir, root, backend } = localFixture(t);
  const outside = path.join(dir, 'outside.md');
  const link = path.join(root.path, 'draft.md');
  fs.symlinkSync('../outside.md', link);
  const out = await backend.writeUpload(root, root.path, 'draft.md', Buffer.from('upload'));
  assert.equal(fs.existsSync(outside), false);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(out.savedAs, 'draft (2).md');
  assert.equal(fs.readFileSync(parseToken(out.token).innerPath, 'utf8'), 'upload');
});

test('local create and upload skip dangling names and retry exclusive-create collisions', async (t) => {
  const { dir, root, backend } = localFixture(t);
  const outside = path.join(dir, 'outside.md');
  const link = path.join(root.path, 'note.md');
  fs.symlinkSync(outside, link);
  assert.equal((await backend.createFile(root, root.path, 'note')).name, 'note (2).md');
  assert.equal((await backend.writeUpload(root, root.path, 'note.md', Buffer.from('upload'))).savedAs, 'note (3).md');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.existsSync(outside), false);

  const write = fs.writeFileSync;
  const raced = new Set();
  t.mock.method(fs, 'writeFileSync', (dest, data, options) => {
    // Insert a competing link after name selection, just before the real open.
    if (['create.md', 'upload.md'].includes(path.basename(dest)) && !raced.has(dest)) {
      raced.add(dest);
      fs.symlinkSync(outside, dest);
    }
    return write(dest, data, options);
  });
  assert.equal((await backend.createFile(root, root.path, 'create')).name, 'create (2).md');
  assert.equal((await backend.writeUpload(root, root.path, 'upload.md', Buffer.from('safe'))).savedAs, 'upload (2).md');
  assert.equal(raced.size, 2);
  assert.equal(fs.existsSync(outside), false);
  for (const name of ['create.md', 'upload.md']) assert.ok(fs.lstatSync(path.join(root.path, name)).isSymbolicLink());
});

test('local exclusive creation bounds collision retries and propagates other write errors', async (t) => {
  const { root, backend } = localFixture(t);
  for (const [code, status] of [['EEXIST', 409], ['EACCES', 403], ['ENOSPC', 500]]) {
    let attempts = 0;
    t.mock.method(fs, 'writeFileSync', () => {
      attempts += 1;
      assert.ok(attempts <= 1000, 'collision retries must be bounded');
      throw Object.assign(new Error('Injected write failure'), { code });
    });
    await assert.rejects(backend.writeUpload(root, root.path, 'new.md', Buffer.from('data')), { status });
    if (code !== 'EEXIST') assert.equal(attempts, 1);
    t.mock.restoreAll();
  }
  assert.deepEqual(fs.readdirSync(root.path), []);
});

test('local canonical writes preserve valid symlinks and entry operations preserve their targets', async (t) => {
  const { dir, root, backend } = localFixture(t);
  const target = path.join(root.path, 'target.md');
  await backend.writeFile(root, target, 'initial');
  const alias = path.join(dir, 'root-alias');
  fs.symlinkSync(root.path, alias);
  const aliasRoot = { ...root, path: alias };
  const link = path.join(alias, 'link.md');
  fs.symlinkSync('target.md', link);
  await backend.writeFile(aliasRoot, link, 'updated');
  assert.equal(await backend.readFile(aliasRoot, link), 'updated');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  const renamed = await backend.rename(aliasRoot, link, 'renamed');
  assert.ok(fs.lstatSync(parseToken(renamed.token).innerPath).isSymbolicLink());
  await backend.remove(aliasRoot, parseToken(renamed.token).innerPath);
  assert.equal(fs.readFileSync(target, 'utf8'), 'updated');
  assert.equal((await backend.createFile(aliasRoot, alias, 'new')).name, 'new.md');
  assert.equal((await backend.writeUpload(aliasRoot, alias, 'new.md', Buffer.from('upload'))).savedAs, 'new (2).md');
});

test('local rename rejects dangling destinations and rename/remove reject external link entries', async (t) => {
  const { dir, root, backend } = localFixture(t);
  const target = path.join(root.path, 'target.md');
  fs.writeFileSync(target, 'sentinel');
  const dangling = path.join(root.path, 'occupied.md');
  fs.symlinkSync(path.join(dir, 'missing.md'), dangling);
  await assert.rejects(backend.rename(root, target, 'occupied'), { status: 409 });
  assert.ok(fs.lstatSync(dangling).isSymbolicLink());
  const outsideLink = path.join(dir, 'outside-link.md');
  fs.symlinkSync(target, outsideLink);
  await assert.rejects(backend.rename(root, outsideLink, 'moved'), { status: 403 });
  await assert.rejects(backend.remove(root, outsideLink), { status: 403 });
  assert.ok(fs.lstatSync(outsideLink).isSymbolicLink());
  assert.equal(fs.existsSync(path.join(dir, 'moved.md')), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'sentinel');
});

test('local permission failures stay forbidden for every file operation', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('Requires POSIX permissions and a non-root user');
  const { root, backend } = localFixture(t);
  const locked = path.join(root.path, 'locked');
  fs.mkdirSync(locked);
  const target = path.join(locked, 'keep.md');
  fs.writeFileSync(target, 'sentinel');
  fs.chmodSync(locked, 0);
  try {
    assert.throws(() => fs.realpathSync(target), { code: 'EACCES' });
    for (const op of [
      () => backend.readFile(root, target),
      () => backend.writeFile(root, target, 'bad'),
      () => backend.createFile(root, locked, 'new'),
      () => backend.writeUpload(root, locked, 'new.md', Buffer.from('bad')),
      () => backend.rename(root, target, 'new'),
      () => backend.remove(root, target),
    ]) await assert.rejects(op(), { status: 403 });
  } finally { fs.chmodSync(locked, 0o700); }
  assert.deepEqual(fs.readdirSync(locked), ['keep.md']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'sentinel');
});

test('local writes use the validated canonical target and refuse a final-component swap', async (t) => {
  if (!fs.constants.O_NOFOLLOW) return t.skip('Requires O_NOFOLLOW');
  const { dir, root, backend } = localFixture(t);
  const target = path.join(root.path, 'target.md');
  const link = path.join(root.path, 'alias.md');
  const outside = path.join(dir, 'outside.md');
  fs.writeFileSync(target, 'inside');
  fs.writeFileSync(outside, 'sentinel');
  fs.symlinkSync(target, link);
  const open = fs.openSync;
  let intercepted = false;
  t.mock.method(fs, 'openSync', (file, flags, ...args) => {
    intercepted = true;
    assert.equal(file, target);
    assert.ok(flags & fs.constants.O_NOFOLLOW);
    fs.unlinkSync(target);
    fs.symlinkSync(outside, target);
    return open(file, flags, ...args);
  });
  await assert.rejects(backend.writeFile(root, link, 'bad'), { status: 403 });
  assert.ok(intercepted);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(outside, 'utf8'), 'sentinel');
});

test('local write closes its file descriptor when writing fails', async (t) => {
  const { root, backend } = localFixture(t);
  const write = fs.writeFileSync;
  let descriptor;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (typeof file !== 'number') return write(file, ...args);
    descriptor = file;
    throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
  });
  await assert.rejects(backend.writeFile(root, path.join(root.path, 'new.md'), 'data'), { status: 500 });
  assert.equal(typeof descriptor, 'number');
  assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
});

test('local HTTP routes preserve boundary errors, collision handling and upload results', async (t) => {
  const { dir, root } = localFixture(t);
  const paths = require('../server/lib/paths');
  t.mock.method(paths, 'loadConfig', () => ({ roots: [root] }));
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/content', require('../server/routes/content'));
  app.use('/api/files', require('../server/routes/files'));
  app.use('/api/upload', require('../server/routes/upload'));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const outside = path.join(dir, 'outside.md');
  const link = path.join(root.path, 'draft.md');
  fs.symlinkSync(outside, link);
  const put = await fetch(`${base}/api/content`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: encodeToken(root, link), content: 'bad' }),
  });
  assert.equal(put.status, 403);
  const missing = await fetch(`${base}/api/content?path=${encodeURIComponent(encodeToken(root, path.join(root.path, 'missing.md')))}`);
  assert.equal(missing.status, 404);
  const create = await fetch(`${base}/api/files/new`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: encodeToken(root, root.path), name: 'draft' }),
  });
  assert.equal(create.status, 200);
  const created = await create.json();
  assert.equal(created.name, 'draft (2).md');
  const rename = await fetch(`${base}/api/files/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: created.path, newName: 'draft' }),
  });
  assert.equal(rename.status, 409);
  const outsideLink = path.join(dir, 'inward.md');
  fs.symlinkSync(parseToken(created.path).innerPath, outsideLink);
  const remove = await fetch(`${base}/api/files?path=${encodeURIComponent(encodeToken(root, outsideLink))}`, { method: 'DELETE' });
  assert.equal(remove.status, 403);
  assert.ok(fs.lstatSync(outsideLink).isSymbolicLink());
  for (const folder of [root.path, dir]) {
    const form = new FormData();
    form.append('folder', encodeToken(root, folder));
    form.append('files', new Blob(['upload']), 'draft.md');
    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const result = await response.json();
    if (folder === root.path) {
      assert.equal(result.written[0].savedAs, 'draft (3).md');
      assert.deepEqual(result.skipped, []);
    } else {
      assert.deepEqual(result.written, []);
      assert.match(result.skipped[0].reason, /outside configured root/);
    }
  }
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.existsSync(outside), false);
});

test('tokens retain special characters and reject wrong roots or types', () => {
  const root = { id: 'qa', type: 'remote' };
  const inner = '~/notes/a # % ::.md';
  const token = encodeToken(root, inner);
  assert.deepEqual(resolveToken({ roots: [root] }, token), { root, innerPath: inner });
  assert.throws(() => resolveToken({ roots: [] }, token), { status: 404 });
  assert.throws(() => resolveToken({ roots: [{ ...root, type: 'local' }] }, token), { status: 400 });
  assert.throws(() => parseToken('bad'), { status: 400 });
});

// No installed core or SSH server is needed for backend error mapping tests.
class ConnectionError extends Error {}
const remoteRoot = { id: 'qa', name: 'QA', type: 'remote', host: '127.0.0.1', user: 'qa' };
function remoteFixture(rfs, failure) {
  const backend = new SftpBackend({ pool: {
    async withSession(_endpoint, fn) {
      if (failure) throw failure;
      return fn({});
    },
  } });
  backend.core = async () => ({
    adhocEndpoint: (input) => input,
    SshConnectionError: ConnectionError,
    RemoteFs: class { constructor() { return rfs; } },
  });
  return backend;
}

test('remote connection errors become 503 and existing HTTP statuses survive', async () => {
  for (const error of [new ConnectionError('authentication failed'), new Error('ECONNREFUSED connection refused')]) {
    await assert.rejects(remoteFixture({}, error).listTree(remoteRoot), { status: 503 });
  }
  const forbidden = Object.assign(new ConnectionError('permission denied'), { status: 403 });
  await assert.rejects(remoteFixture({}, forbidden).listTree(remoteRoot), (e) => e === forbidden);
  const unknown = new Error('unexpected backend failure');
  await assert.rejects(remoteFixture({}, unknown).listTree(remoteRoot), (e) => e === unknown);
});

test('remote SFTP failures map to 404/403 without masking unrelated failures', async () => {
  for (const [code, status] of [[2, 404], [3, 403], [4, undefined]]) {
    const error = Object.assign(new Error('SFTP failure'), { code });
    const rfs = {
      expandHome: async (p) => p,
      path: { isUnder: () => true },
      readFile: async () => { throw error; },
      writeFile: async () => { throw error; },
    };
    const backend = remoteFixture(rfs);
    for (const op of [() => backend.readFile(remoteRoot, '~/a.md'), () => backend.writeFile(remoteRoot, '~/a.md', '')]) {
      await assert.rejects(op(), (e) => e === error && e.status === status);
    }
  }
});

test('remote uploads stop on permission errors instead of choosing another filename', async () => {
  const error = Object.assign(new Error('Permission denied'), { code: 3 });
  const rfs = {
    expandHome: async (p) => p,
    path: { isUnder: () => true, join: path.posix.join },
    stat: async () => { throw error; },
    writeFile: async () => assert.fail('Must not write after stat fails'),
  };
  await assert.rejects(remoteFixture(rfs).writeUpload(remoteRoot, '~', 'a.md', Buffer.from('QA')), { status: 403 });
});

test('remote directories load one level on POSIX and Windows, including independent pins', async () => {
  for (const [os, base] of [['posix', "/srv/qa's notes"], ['windows', 'C:/Users/qa']]) {
    const listed = [];
    const rfs = {
      session: { os, sftp: async () => ({ realpath: (p, cb) => cb(null, p) }) },
      expandHome: async () => base,
      path: { join: path.posix.join, basename: path.posix.basename, isUnder: (a, b) => b.startsWith(`${a}/`) },
      list: async (dir) => {
        listed.push(dir);
        return dir === base ? [
          { type: 'file', name: 'A.MD', path: `${dir}/A.MD` },
          { type: 'dir', name: 'notes', path: `${dir}/notes` },
          { type: 'dir', name: '.hidden', path: `${dir}/.hidden` },
          { type: 'symlink', name: 'escape', path: `${dir}/escape` },
          { type: 'file', name: 'skip.txt', path: `${dir}/skip.txt` },
        ] : [{ type: 'file', name: 'b.mdx', path: `${dir}/b.mdx` }];
      },
    };
    const backend = remoteFixture(rfs);
    const tree = await backend.listTree(remoteRoot);
    assert.deepEqual(listed, [base], 'must never descend into children');
    assert.equal(tree.path, encodeToken(remoteRoot, base));
    assert.deepEqual(tree.children.map((n) => n.name), ['notes', 'A.MD']);
    assert.equal(tree.children[0].children, null, 'unloaded is distinct from empty');
    assert.equal(tree.children[0].rel, 'notes');
    const pin = await remoteFixture(rfs).listTree(remoteRoot, 'deep/pin');
    assert.deepEqual(listed, [base, `${base}/deep/pin`], 'pins must not read ancestors');
    assert.equal(pin.rel, 'deep/pin');
    assert.equal(pin.children[0].path, encodeToken(remoteRoot, `${base}/deep/pin/b.mdx`));
    rfs.list = async () => [];
    assert.deepEqual((await backend.listTree(remoteRoot, 'empty')).children, []);
  }
});

test('remote listing rejects invalid paths, symlink escapes and maps directory errors', async () => {
  const base = '/home/qa';
  const rfs = {
    session: { sftp: async () => ({ realpath: (_p, cb) => cb(null, '/outside') }) },
    expandHome: async () => base,
    path: { join: path.posix.join, isUnder: (a, b) => b.startsWith(`${a}/`) },
    list: async () => assert.fail('Invalid paths must not be listed'),
  };
  const backend = remoteFixture(rfs);
  for (const rel of ['../escape', '/outside', 'C:/outside', 'notes/../escape', ['notes'], 'bad\0path']) {
    await assert.rejects(backend.listTree(remoteRoot, rel), { status: 400 });
  }
  for (const rel of ['.hidden', 'notes/.hidden', 'escape']) {
    await assert.rejects(backend.listTree(remoteRoot, rel), { status: 403 });
  }
  for (const [code, status] of [[2, 404], [3, 403]]) {
    rfs.list = async () => { throw Object.assign(new Error('SFTP failure'), { code }); };
    await assert.rejects(backend.listTree(remoteRoot), { status });
  }
});

test('stalled directory requests return 504 and close their session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ended = 0;
  const backend = remoteFixture({
    session: { end: () => { ended += 1; } },
    expandHome: async () => new Promise(() => {}),
  });
  const result = backend.listTree(remoteRoot);
  const rejected = assert.rejects(result, { status: 504, message: 'Directory listing timed out after 15 seconds' });
  await new Promise(setImmediate);
  t.mock.timers.tick(15000);
  await rejected;
  assert.equal(ended, 1);
});

test('config reload closes the shared remote pool and local routing stays independent', () => {
  const backend = backendFor(remoteRoot);
  let closed = 0;
  backend.shared.pool = { closeAll() { closed += 1; } };
  resetRemote();
  resetRemote();
  assert.equal(closed, 1);
  assert.equal(backend.shared.pool, null);
  assert.ok(backendFor({ type: 'local' }) instanceof LocalBackend);
});
