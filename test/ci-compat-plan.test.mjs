import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOSTS, FULL_HOST, selectCompatibilityTests } from '../scripts/run-compat-tests.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('grouped compatibility covers every official fixture and all existing test files on the full host', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/compatibility.yml'), 'utf8');
  assert.equal(HOSTS.length, 6);
  assert.equal(new Set(HOSTS).size, 6);
  for (const host of HOSTS) {
    assert.ok(workflow.includes(host), host);
    const tests = selectCompatibilityTests(root, host);
    assert.ok(tests.includes('test/host-compat.test.mjs'), host);
  }
  const full = selectCompatibilityTests(root, FULL_HOST);
  for (const dir of ['test','maintenance','maintenance/desktop-tools']) {
    const names = fs.readdirSync(path.join(root, dir)).filter(n => dir === 'test' ? /\.test\.(?:js|mjs|cjs)$/.test(n) : n.endsWith('.test.mjs'));
    for (const name of names) assert.ok(full.includes(dir + '/' + name), name);
  }
  assert.ok(full.length > selectCompatibilityTests(root, HOSTS[0]).length);
});

test('additional fixture-dependent test files automatically run on each host', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-ci-selection-'));
  t.after(() => fs.rmSync(temp, {recursive:true,force:true}));
  for (const dir of ['test','maintenance/desktop-tools']) fs.mkdirSync(path.join(temp, dir), {recursive:true});
  const marker = 'DSH_COMPAT_' + 'HOST_ROOT';
  fs.writeFileSync(path.join(temp, 'test/host-compat.test.mjs'), marker);
  fs.writeFileSync(path.join(temp, 'maintenance/extra.test.mjs'), marker);
  fs.writeFileSync(path.join(temp, 'test/common.test.mjs'), 'fixture independent');
  assert.deepEqual(selectCompatibilityTests(temp, HOSTS[0]), ['maintenance/extra.test.mjs','test/host-compat.test.mjs']);
  assert.ok(selectCompatibilityTests(temp, FULL_HOST).includes('test/common.test.mjs'));
  assert.throws(() => selectCompatibilityTests(temp, 'unknown'), /Unknown official fixture/);
});
