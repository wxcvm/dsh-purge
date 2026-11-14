import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCaptureConfig } from '../scripts/capture-task-quality.mjs';

test('capture requires three existing isolated like-for-like profiles before any model call', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-capture-config-'));
  try {
    const config = { exe: root, cli: root, dshHome: root, runtime: root };
    for (const name of ['host', 'current', 'candidate']) {
      mkdirSync(join(root, 'profiles', name), { recursive: true });
      writeFileSync(join(root, 'profiles', name, 'package.json'), '{}');
      config[name] = { profile: name, variant: name, model: 'fixture/model', hostVersion: '0.2.2-rc.3', environment: 'fixture', settings: {} };
    }
    assert.equal(validateCaptureConfig(config), config);
    config.candidate.profile = 'current'; assert.throws(() => validateCaptureConfig(config), /distinct/);
    config.candidate.profile = 'candidate'; config.candidate.model = 'different'; assert.throws(() => validateCaptureConfig(config), /comparison mismatch/);
    config.candidate.model = 'fixture/model'; config.candidate.profile = 'missing'; assert.throws(() => validateCaptureConfig(config), /existing isolated/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
