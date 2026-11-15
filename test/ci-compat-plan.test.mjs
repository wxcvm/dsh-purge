import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOSTS, FULL_HOST, selectCompatibilityTests } from '../scripts/run-compat-tests.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const readWorkflow = name => fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8').replace(/\r\n/g, '\n');
test('daily CI covers the latest official fixture and all existing tests; older fixtures remain selectable', () => {
  const workflow = readWorkflow('compatibility.yml');
  assert.equal(HOSTS.length, 7);
  assert.equal(new Set(HOSTS).size, 7);
  assert.equal(FULL_HOST, '0.2.2-rc.3');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.dshTarget, FULL_HOST);
  assert.ok(manifest.dshTargets.includes(FULL_HOST));
  const workflowHosts = [...workflow.matchAll(/hosts: '([^']+)'/g)].flatMap(match => match[1].split(' '));
  assert.deepEqual(workflowHosts, [FULL_HOST]);
  assert.match(workflow, /node scripts\/run-compat-tests\.mjs \$\{\{ matrix\.hosts \}\}/);
  for (const host of HOSTS) {
    const tests = selectCompatibilityTests(root, host);
    assert.ok(tests.includes('test/host-compat.test.mjs'), host);
  }
  const full = selectCompatibilityTests(root, FULL_HOST);
  for (const dir of ['test','maintenance','maintenance/desktop-tools']) {
    const names = fs.readdirSync(path.join(root, dir)).filter(n => dir === 'test' ? /\.test\.(?:js|mjs|cjs)$/.test(n) : n.endsWith('.test.mjs'));
    for (const name of names) assert.ok(full.includes(dir + '/' + name), name);
  }
  assert.ok(full.length > selectCompatibilityTests(root, HOSTS[0]).length);
  // The daily two-job matrix covers every former standalone repair test.
  const repair = readWorkflow('repair-center.yml');
  const pending = readWorkflow('pending-specs.yml');
  for (const name of repair.match(/node --test ([^\n\r]+)/)[1].split(' ')) assert.ok(full.includes(name), name);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /branches: \[master, beta,/);
  assert.match(workflow, /id: specs\s+if: .*runner\.os == 'Linux'.*root-install\.outcome == 'success'.*\n\s+continue-on-error: true\s+run: node --test test-pending\/\*\.mjs/);
  assert.match(workflow, /PENDING_OUTCOME: \$\{\{ steps\.specs\.outcome \}\}/);
  for (const standalone of [repair, pending]) assert.match(standalone, /on:\s*\n  workflow_dispatch:\s*\n(?:\s*\n)?(?:permissions:|concurrency:)/);
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
