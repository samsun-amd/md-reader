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

test('POSIX remote listing builds frontend tokens and excludes hidden/outside paths', async () => {
  const backend = remoteFixture({});
  const base = "/srv/qa's notes";
  let command;
  const children = await backend.listViaExec({ exec: async (cmd) => {
    command = cmd;
    return { stdout: `${base}/sub/b.mdx\n${base}/a.md\n${base}/.hidden/c.md\n/other/no.md\n${base}/no.txt\n` };
  } }, remoteRoot, base);
  assert.match(command, /^bash -lc /);
  assert.ok(command.includes('rg --files'));
  assert.deepEqual(children.map((n) => n.name), ['sub', 'a.md']);
  assert.equal(children[0].children[0].path, encodeToken(remoteRoot, `${base}/sub/b.mdx`));
});

test('Windows remote listing uses SFTP and preserves root response shape', async () => {
  const rfs = {
    session: { os: 'windows' },
    expandHome: async () => 'C:/Users/qa',
    list: async (dir) => dir.endsWith('/notes')
      ? [{ type: 'file', name: 'a.md', path: `${dir}/a.md` }]
      : [{ type: 'dir', name: 'notes', path: `${dir}/notes` }, { type: 'file', name: 'skip.txt', path: `${dir}/skip.txt` }],
  };
  const tree = await remoteFixture(rfs).listTree(remoteRoot);
  assert.equal(tree.type, 'root');
  assert.equal(tree.path, 'remote:qa::C:/Users/qa');
  assert.deepEqual(tree.children.map((n) => n.name), ['notes']);
  assert.equal(tree.children[0].children[0].path, 'remote:qa::C:/Users/qa/notes/a.md');
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
