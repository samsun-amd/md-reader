const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../server/lib/configStore');
const { normalizeRoot, validateRoots, safeRelPath } = require('../server/lib/paths');

test('editing remote roots preserves pins and applies password keep/set/clear semantics', () => {
  const raw = { roots: [], port: 12345, readOnly: true };
  const input = { id: 'qa', name: 'QA', type: 'remote', host: '127.0.0.1', user: 'qa', password: 'qa-secret' };
  store.addRoot(raw, input);
  store.addPin(raw, 'qa', 'notes');
  store.addPin(raw, 'qa', 'notes');
  store.updateRoot(raw, 'qa', { ...input, id: 'changed', password: undefined, pins: [] });
  assert.equal(raw.roots[0].id, 'qa');
  assert.equal(raw.roots[0].password, 'qa-secret');
  assert.deepEqual(raw.roots[0].pins, ['notes']);
  let view = store.rootsForClient(raw)[0];
  assert.equal(view.hasPassword, true);
  assert.equal(Object.hasOwn(view, 'password'), false);
  assert.ok(!JSON.stringify(view).includes('qa-secret'));
  store.updateRoot(raw, 'qa', { ...input, password: 'replacement' });
  assert.equal(raw.roots[0].password, 'replacement');
  store.updateRoot(raw, 'qa', { ...input, password: '' });
  assert.equal(Object.hasOwn(raw.roots[0], 'password'), false);
  view = store.rootsForClient(raw)[0];
  assert.equal(view.hasPassword, false);
  store.removePin(raw, 'qa', 'notes');
  assert.equal(Object.hasOwn(raw.roots[0], 'pins'), false);
  store.removeRoot(raw, 'qa');
  assert.deepEqual(raw, { roots: [], port: 12345, readOnly: true });
});

test('root validation and pin paths reject ambiguous or escaping input', () => {
  const raw = { roots: [] };
  const root = { id: 'qa', type: 'remote', host: '127.0.0.1', user: 'qa' };
  store.addRoot(raw, root);
  assert.throws(() => store.addRoot(raw, root), { status: 400 });
  assert.throws(() => store.updateRoot(raw, 'missing', root), { status: 404 });
  assert.throws(() => validateRoots([normalizeRoot({ ...root, host: '' }, 0)]), /host/);
  assert.throws(() => validateRoots([normalizeRoot({ ...root, user: '' }, 0)]), /user/);
  assert.equal(normalizeRoot(root, 0).remotePath, '~');
  assert.equal(normalizeRoot({ name: 'Docs', path: '~/docs' }, 0).type, 'local');
  assert.equal(safeRelPath('notes\\sub'), 'notes/sub');
  for (const pin of ['../escape', '/absolute', 'C:/outside', '.', 'notes/../escape']) {
    assert.throws(() => safeRelPath(pin), { status: 400 });
  }
});

test('config persistence and reload use an isolated copy and reject invalid writes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader config QA '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lib = path.join(dir, 'server/lib');
  fs.mkdirSync(lib, { recursive: true });
  for (const name of ['paths.js', 'configStore.js']) {
    fs.copyFileSync(path.join(__dirname, '../server/lib', name), path.join(lib, name));
  }
  const isolated = require(path.join(lib, 'configStore.js'));
  const paths = require(path.join(lib, 'paths.js'));
  const cfg = { roots: [{ id: 'docs', type: 'local', path: '~/docs' }], port: 12345 };
  isolated.writeRawConfig(cfg);
  assert.deepEqual(isolated.readRawConfig(), cfg);
  assert.equal(fs.existsSync(`${paths.CONFIG_PATH}.tmp`), false);
  assert.equal(paths.loadConfig().roots[0].id, 'docs');
  isolated.writeRawConfig({ ...cfg, roots: [{ ...cfg.roots[0], id: 'new' }] });
  assert.equal(paths.loadConfig().roots[0].id, 'docs');
  assert.equal(paths.reloadConfig().roots[0].id, 'new');
  const saved = fs.readFileSync(paths.CONFIG_PATH, 'utf8');
  assert.throws(() => isolated.writeRawConfig({ roots: [cfg.roots[0], cfg.roots[0]] }), /Duplicate/);
  assert.throws(() => isolated.writeRawConfig({ roots: [{ ...cfg.roots[0], pins: 'bad' }] }), /pins/);
  assert.equal(fs.readFileSync(paths.CONFIG_PATH, 'utf8'), saved);
});
