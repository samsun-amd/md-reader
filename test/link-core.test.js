const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader link QA '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'md-reader');
  const core = path.join(dir, 'ssh-manager/packages/core');
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(core, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../scripts/link-core.sh'), path.join(app, 'scripts/link-core.sh'));
  fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({
    name: 'core-qa-fixture', version: '1.0.0', main: 'dist/index.js',
    scripts: { build: 'node build.cjs' },
  }));
  fs.writeFileSync(path.join(core, 'source.js'), 'module.exports = "fresh";\n');
  fs.writeFileSync(path.join(core, 'build.cjs'), `
    const fs = require('node:fs');
    if (fs.existsSync('fail-build')) process.exit(7);
    fs.copyFileSync('source.js', 'dist/index.js');
  `);
  const link = path.join(app, 'node_modules/@ssh-manager/core');
  function run(extra = {}) {
    const result = spawnSync('bash', [path.join(app, 'scripts/link-core.sh')], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, SSH_MANAGER_CORE: '', npm_config_offline: 'true', ...extra },
    });
    assert.ifError(result.error);
    return result;
  }
  return { dir, app, core, link, run };
}

test('link-core builds missing dist and rebuilds an existing stale dist', (t) => {
  const f = fixture(t);
  let result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.realpathSync(f.link), f.core);
  assert.match(fs.readFileSync(path.join(f.core, 'dist/index.js'), 'utf8'), /fresh/);
  fs.writeFileSync(path.join(f.core, 'source.js'), 'module.exports = "updated";\n');
  result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(fs.readFileSync(path.join(f.core, 'dist/index.js'), 'utf8'), /updated/);
});

test('link-core accepts an override containing spaces and restores a pruned link', (t) => {
  const f = fixture(t);
  const moved = path.join(f.dir, 'custom core');
  fs.renameSync(f.core, moved);
  const env = { SSH_MANAGER_CORE: moved };
  assert.equal(f.run(env).status, 0);
  fs.unlinkSync(f.link);
  const result = f.run(env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.realpathSync(f.link), moved);
});

test('link-core stops on a failed build even when old dist can be loaded', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.core, 'dist/index.js'), 'module.exports = "stale";\n');
  fs.writeFileSync(path.join(f.core, 'fail-build'), '');
  const result = f.run();
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(f.link), false);
  assert.doesNotMatch(result.stdout, /linked & resolves OK/);
});

test('link-core rejects missing core and unloadable build output', (t) => {
  const f = fixture(t);
  let result = f.run({ SSH_MANAGER_CORE: path.join(f.dir, 'missing') });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find/);
  fs.writeFileSync(path.join(f.core, 'source.js'), 'throw new Error("QA invalid build");\n');
  result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /core symlink does not resolve/);
});
