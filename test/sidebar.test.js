const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fileTreeSource = fs.readFileSync(path.join(__dirname, '../client/src/components/FileTree.jsx'), 'utf8');
const treeKey = vm.runInNewContext(`(${fileTreeSource.match(/export (function treeKey[\s\S]*?\n\})/)[1]})`);

const source = fs.readFileSync(path.join(__dirname, '../client/src/components/Sidebar.jsx'), 'utf8');

// Run the actual request handler without a browser or a second copy of its logic.
function loader() {
  const match = source.match(/const loadRoot = useCallback\((async \(id, rel = ''\) => \{[\s\S]*?\n  \}), \[\]\);/);
  assert.ok(match, 'loadRoot callback must be available');
  let trees = {};
  const pending = [];
  const load = vm.runInNewContext(`(${match[1]})`, {
    setTrees: (update) => { trees = update(trees); },
    treeKey,
    fetch: (url) => new Promise((resolve) => pending.push({ url, resolve })),
  });
  return {
    load,
    urls: () => pending.map((p) => p.url),
    trees: () => trees,
    reset: () => { trees = {}; },
    reply: (index, ok, data) => pending[index].resolve({ ok, status: ok ? 200 : 503, json: async () => data }),
  };
}

test('late tree responses cannot overwrite a newer success or failure', async () => {
  for (const oldOk of [true, false]) {
    const f = loader();
    const old = f.load('servant');
    const fresh = f.load('servant');
    f.reply(1, !oldOk, oldOk ? { error: 'current failure' } : { name: 'current tree' });
    await fresh;
    const current = f.trees();
    assert.equal(current[treeKey('servant')].status, oldOk ? 'error' : 'ready');
    f.reply(0, oldOk, oldOk ? { name: 'stale tree' } : { error: 'exec timed out' });
    await old;
    assert.equal(f.trees(), current);
  }
});

test('clearing trees invalidates pending responses while other roots remain independent', async () => {
  const f = loader();
  const old = f.load('servant');
  f.reset();
  const other = f.load('other');
  f.reply(1, true, { name: 'other tree' });
  await other;
  f.reply(0, false, { error: 'exec timed out' });
  await old;
  assert.equal(f.trees()[treeKey('servant')], undefined);
  assert.equal(f.trees()[treeKey('other')].status, 'ready');
});

test('remote refresh loads only visible roots and reuses already loaded trees', () => {
  const match = source.match(/useEffect\(\(\) => \{\n    for \(const r of [\s\S]*?\n  \}, \[[^\]]+\]\);/);
  assert.ok(match, 'root loading effect must be available');
  const loaded = [];
  const context = {
    useEffect: (effect) => effect(),
    visibleRoots: [{ id: 'servant' }],
    localRoots: [{ id: 'slow-local' }],
    trees: {},
    treeKey,
    loadRoot: (id) => loaded.push(id),
  };
  vm.runInNewContext(match[0], context);
  assert.deepEqual(loaded, ['servant']);
  context.trees[treeKey('servant')] = { status: 'ready' };
  vm.runInNewContext(match[0], context);
  assert.deepEqual(loaded, ['servant']);
});


test('a pin can load while home fails and directory requests encode special characters', async () => {
  const f = loader();
  const home = f.load('servant');
  const pin = f.load('servant', 'deep/a # & notes');
  assert.equal(f.urls()[1], '/api/files/root/servant?rel=deep%2Fa%20%23%20%26%20notes');
  f.reply(0, false, { error: 'home failed' });
  f.reply(1, true, { children: [] });
  await Promise.all([home, pin]);
  assert.equal(f.trees()[treeKey('servant')].status, 'error');
  assert.equal(f.trees()[treeKey('servant', 'deep/a # & notes')].status, 'ready');
  const old = f.load('servant', 'notes');
  f.reset();
  const fresh = f.load('servant', 'notes');
  f.reply(3, true, { children: [] });
  await fresh;
  const current = f.trees();
  f.reply(2, false, { error: 'stale error' });
  await old;
  assert.equal(f.trees(), current);
});

test('only expanded, unloaded remote directories fetch children; cached/error states do not loop', () => {
  const match = fileTreeSource.match(/useEffect\(\(\) => \{\n    if \(expanded[\s\S]*?\n  \}, \[[^\]]+\]\);/);
  assert.ok(match);
  const loaded = [];
  const context = {
    useEffect: (effect) => effect(),
    expanded: false, lazy: true, state: undefined, rootId: 'servant', node: { rel: 'notes' },
    onLoadDirectory: (...args) => loaded.push(args),
  };
  const run = () => vm.runInNewContext(match[0], context);
  run();
  assert.equal(loaded.length, 0);
  context.expanded = true;
  run();
  assert.deepEqual(loaded, [['servant', 'notes']]);
  for (const status of ['loading', 'ready', 'error']) {
    context.state = { status };
    run();
  }
  context.state = undefined;
  context.lazy = false;
  run();
  assert.equal(loaded.length, 1);
});
