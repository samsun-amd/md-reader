const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// This suite intentionally requires a linked, built core. Run link-core first.
const core = require('@ssh-manager/core');
const { SftpBackend } = require('../../server/lib/backend');
const { parseToken } = require('../../server/lib/paths');

test('real core supports md-reader endpoints, tree and file operations without inventory or SSH', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader core QA '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = {
    id: 'qa', name: 'QA', type: 'remote', host: '127.0.0.1', port: 2222,
    user: 'qa', password: 'fixture-only', os: 'posix', remotePath: '~',
  };
  const backend = new SftpBackend({ pool: null });
  const originalLoad = core.Inventory.load;
  core.Inventory.load = () => assert.fail('md-reader must not load sshm inventory');
  t.after(() => { core.Inventory.load = originalLoad; });
  const endpoint = await backend.endpointFor(root);
  assert.deepEqual(endpoint.conn, { host: root.host, port: 2222, user: 'qa', password: root.password });
  assert.equal(endpoint.id, 'qa');
  assert.equal(endpoint.jump, undefined);
  assert.ok(backend.shared.pool instanceof core.SshPool);
  t.after(() => backend.shared.pool.closeAll());

  // The real RemoteFs runs against local temporary files through the SFTP API.
  const sftp = {
    realpath: (p, cb) => fs.realpath(p === '.' ? dir : p, cb),
    readdir: (p, cb) => fs.readdir(p, (err, names) => cb(err, names?.map((filename) => ({
      filename, attrs: fs.lstatSync(path.join(p, filename)),
    })))),
    stat: fs.stat,
    createReadStream: fs.createReadStream,
    createWriteStream: fs.createWriteStream,
    rename: fs.rename,
    unlink: fs.unlink,
  };
  const session = {
    os: 'posix', sftp: async () => sftp,
    exec: async () => assert.fail('SFTP listing must not execute a recursive command'),
  };
  let sessions = 0;
  backend.shared.pool.withSession = async (selected, fn) => {
    assert.deepEqual(selected, endpoint);
    sessions += 1;
    return fn(session);
  };
  const created = await backend.createFile(root, '~', 'note');
  assert.equal(created.name, 'note.md');
  const file = parseToken(created.token).innerPath;
  assert.equal(file, path.join(dir, 'note.md'));
  const content = '# Core QA\n\u6e2c\u8a66';
  assert.deepEqual(await backend.writeFile(root, file, content), { bytes: Buffer.byteLength(content) });
  assert.equal(await backend.readFile(root, file), content);
  const tree = await backend.listTree(root);
  assert.deepEqual(tree.children, [{ name: 'note.md', path: created.token, type: 'file' }]);
  const upload = await backend.writeUpload(root, '~', 'note.md', Buffer.from('upload'));
  assert.equal(upload.savedAs, 'note (2).md');
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.equal(await backend.readFile(root, parseToken(upload.token).innerPath), 'upload');
  const renamed = await backend.rename(root, file, 'renamed');
  await backend.remove(root, parseToken(renamed.token).innerPath);
  await assert.rejects(backend.readFile(root, parseToken(renamed.token).innerPath), { status: 404 });
  await assert.rejects(backend.readFile(root, path.join(path.dirname(dir), 'outside.md')), { status: 403 });
  assert.ok(sessions >= 10);

  backend.shared.pool.withSession = async () => { throw new core.SshConnectionError('qa', 'QA unavailable'); };
  await assert.rejects(backend.listTree(root), { status: 503 });
});
