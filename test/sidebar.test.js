const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../client/src/components/Sidebar.jsx'), 'utf8');

// Run the actual request handler without a browser or a second copy of its logic.
function loader() {
  const match = source.match(/const loadRoot = useCallback\((async \(id\) => \{[\s\S]*?\n  \}), \[\]\);/);
  assert.ok(match, 'loadRoot callback must be available');
  let trees = {};
  const pending = [];
  const load = vm.runInNewContext(`(${match[1]})`, {
    setTrees: (update) => { trees = update(trees); },
    fetch: () => new Promise((resolve) => pending.push(resolve)),
  });
  return {
    load,
    trees: () => trees,
    reset: () => { trees = {}; },
    reply: (index, ok, data) => pending[index]({ ok, json: async () => data }),
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
    assert.equal(current.servant.status, oldOk ? 'error' : 'ready');
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
  assert.equal(f.trees().servant, undefined);
  assert.equal(f.trees().other.status, 'ready');
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
    loadRoot: (id) => loaded.push(id),
  };
  vm.runInNewContext(match[0], context);
  assert.deepEqual(loaded, ['servant']);
  context.trees.servant = { status: 'ready' };
  vm.runInNewContext(match[0], context);
  assert.deepEqual(loaded, ['servant']);
});
