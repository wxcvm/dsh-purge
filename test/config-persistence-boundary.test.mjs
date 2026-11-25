/**
 * Configuration persistence across page navigation and reloads.
 * Tests the read/write cycle of platform-config.js without network,
 * host services, or UI state management.
 *
 * Each test gets an isolated temp directory to avoid cross-test contamination.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPlatformConfig,
  savePlatformConfig,
  configPathOf,
} from '../lib/redteam/platform-config.js';

const testRoot = mkdtempSync(join(tmpdir(), 'dsh-config-persist-'));

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function isolatedRedteamDir(testName) {
  return mkdtempSync(join(testRoot, `${testName}-`));
}

test('fresh load returns empty defaults with exists=false', () => {
  const redteamDir = isolatedRedteamDir('fresh-load');
  const cfg = loadPlatformConfig(redteamDir);
  assert.equal(cfg.exists, false, 'fresh config should not exist');
  assert.equal(cfg.error, undefined, 'no error on fresh load');
  assert.ok(cfg.path, 'path should be set');
  // env has default keys initialized to empty strings
  assert.deepEqual(cfg.env, {
    FOFA_KEY: '',
    CENSYS_PAT: '',
    CENSYS_ORG_ID: '',
    REDTEAM_VPS_HOST: '',
    REDTEAM_VPS_USER: '',
    REDTEAM_VPS_KEY: '',
  }, 'env should have default keys as empty strings');
  assert.equal(cfg.notes, '', 'notes should be empty string');
});

test('save creates config file and next load reads it back', () => {
  const redteamDir = isolatedRedteamDir('save-read-cycle');
  const patch = {
    toolkitDir: '/custom/toolkit',
    binDirs: ['/bin', '/usr/local/bin'],
    notes: 'Test configuration',
    env: { FOFA_KEY: 'test-key-value' },
  };
  const saved = savePlatformConfig(patch, redteamDir);
  assert.equal(saved.exists, true);
  assert.equal(saved.toolkitDir, '/custom/toolkit');
  assert.deepEqual(saved.binDirs, ['/bin', '/usr/local/bin']);
  assert.equal(saved.notes, 'Test configuration');
  assert.equal(saved.env.FOFA_KEY, 'test-key-value');

  const reloaded = loadPlatformConfig(redteamDir);
  assert.equal(reloaded.exists, true);
  assert.equal(reloaded.toolkitDir, '/custom/toolkit');
  assert.deepEqual(reloaded.binDirs, ['/bin', '/usr/local/bin']);
  assert.equal(reloaded.notes, 'Test configuration');
  assert.equal(reloaded.env.FOFA_KEY, 'test-key-value');
});

test('partial updates preserve unmodified fields', () => {
  const redteamDir = isolatedRedteamDir('partial-update');
  const cfg1 = savePlatformConfig({
    toolkitDir: '/path1',
    notes: 'First note',
    env: { FOFA_KEY: 'fofa-value' },
  }, redteamDir);

  const cfg2 = savePlatformConfig({
    notes: 'Updated note',
  }, redteamDir);

  assert.equal(cfg2.toolkitDir, '/path1', 'toolkitDir should persist');
  assert.equal(cfg2.notes, 'Updated note', 'notes should update');
  assert.equal(cfg2.env.FOFA_KEY, 'fofa-value', 'env should persist');
});

test('empty env values are stored and do not leak previous ones', () => {
  const redteamDir = isolatedRedteamDir('env-isolation');
  const cfg1 = savePlatformConfig({
    env: { FOFA_KEY: 'secret', CENSYS_PAT: 'token' },
  }, redteamDir);
  assert.equal(cfg1.env.FOFA_KEY, 'secret');
  assert.equal(cfg1.env.CENSYS_PAT, 'token');

  const cfg2 = savePlatformConfig({
    env: { FOFA_KEY: '' },
  }, redteamDir);
  assert.equal(cfg2.env.FOFA_KEY, '', 'explicit empty should clear FOFA_KEY');
  assert.equal(cfg2.env.CENSYS_PAT, 'token', 'CENSYS_PAT should persist');
  assert.equal(cfg2.env.REDTEAM_VPS_HOST, '', 'other defaults should stay empty');
});

test('binDirs are normalized (trimmed, whitespace and empty removed)', () => {
  const redteamDir = isolatedRedteamDir('bindir-normalize');
  const patch = {
    binDirs: ['/path1', '  /path2  ', '', null, undefined, '/path3'],
  };
  const saved = savePlatformConfig(patch, redteamDir);
  // Note: binDirs preserves order and allows duplicates; only trims and filters empty
  assert.deepEqual(saved.binDirs, ['/path1', '/path2', '/path3'], 'whitespace trimmed, empty filtered');
});

test('updated_at timestamp is refreshed on each save', async () => {
  const redteamDir = isolatedRedteamDir('timestamp-refresh');
  const cfg1 = savePlatformConfig({ notes: 'First' }, redteamDir);
  const time1 = cfg1.updated_at;
  assert.ok(time1, 'first save should set updated_at');

  // Small delay to ensure time difference
  await new Promise(resolve => setTimeout(resolve, 10));

  const cfg2 = savePlatformConfig({ notes: 'Second' }, redteamDir);
  const time2 = cfg2.updated_at;
  assert.ok(time2, 'second save should set updated_at');
  assert.notEqual(time1, time2, 'timestamps should differ');
  assert(new Date(time2) > new Date(time1), 'later save should have later timestamp');
});

test('malformed json file is caught and returns error on load', async () => {
  const redteamDir = isolatedRedteamDir('malformed-json');
  // Write an invalid config file
  const configFile = configPathOf(redteamDir);
  writeFileSync(configFile, '{invalid json}');

  const cfg = loadPlatformConfig(redteamDir);
  assert.equal(cfg.exists, true);
  assert.ok(cfg.error, 'malformed JSON should produce error');
  assert.match(cfg.error, /无法读取或格式无效/, 'error should be in Chinese');
});

test('save rejects if previous config is unreadable', async () => {
  const redteamDir = isolatedRedteamDir('unreadable-config');
  const configFile = configPathOf(redteamDir);
  writeFileSync(configFile, 'not json');

  assert.throws(
    () => savePlatformConfig({ notes: 'test' }, redteamDir),
    (err) => err.message.includes('无法读取或格式无效'),
    'should refuse to overwrite if config is broken'
  );
});

test('scan preferences normalize timeout values', () => {
  const redteamDir = isolatedRedteamDir('timeout-normalize');
  const patch = {
    scanPreferences: {
      timeoutSeconds: 90, // Invalid, should default to 180
      captureDiagnostics: true,
    },
  };
  const saved = savePlatformConfig(patch, redteamDir);
  assert.equal(
    saved.scanPreferences.timeoutSeconds,
    180,
    'invalid timeout should default to 180'
  );

  const patch2 = {
    scanPreferences: { timeoutSeconds: 120 },
  };
  const saved2 = savePlatformConfig(patch2, redteamDir);
  assert.equal(saved2.scanPreferences.timeoutSeconds, 120, 'valid timeout should be accepted');
});

test('privacy management mode is preserved across updates', () => {
  const redteamDir = isolatedRedteamDir('privacy-persist');
  const cfg1 = savePlatformConfig({
    privacyManagement: { mode: 'automatic', locked: ['maskHistory'] },
  }, redteamDir);
  assert.equal(cfg1.privacyManagement.mode, 'automatic');

  const cfg2 = savePlatformConfig({
    notes: 'just a note update',
  }, redteamDir);
  assert.equal(cfg2.privacyManagement.mode, 'automatic', 'privacy mode should persist');
});

test('config file remains valid JSON after sequential saves', () => {
  const redteamDir = isolatedRedteamDir('json-valid');
  const configFile = configPathOf(redteamDir);

  savePlatformConfig({ notes: 'save 1' }, redteamDir);
  let content = readFileSync(configFile, 'utf8');
  assert.doesNotThrow(() => JSON.parse(content), 'JSON should remain valid after save 1');

  savePlatformConfig({ notes: 'save 2' }, redteamDir);
  content = readFileSync(configFile, 'utf8');
  assert.doesNotThrow(() => JSON.parse(content), 'JSON should remain valid after save 2');
});

test('version field is set to 2 on save', () => {
  const redteamDir = isolatedRedteamDir('version-field');
  const cfg1 = savePlatformConfig({ notes: 'test' }, redteamDir);
  assert.equal(cfg1.version, 2, 'schema version should be 2');

  // Version should stay at 2 on next save
  const cfg2 = savePlatformConfig({ notes: 'updated' }, redteamDir);
  assert.equal(cfg2.version, 2, 'version should remain 2 on subsequent save');
});

test('all expected config keys are present after load', () => {
  const redteamDir = isolatedRedteamDir('keys-present');
  const cfg = loadPlatformConfig(redteamDir);
  // Check baseline keys exist
  assert.ok('version' in cfg, 'should have version');
  assert.ok('toolkitDir' in cfg, 'should have toolkitDir');
  assert.ok('env' in cfg, 'should have env');
  assert.ok('notes' in cfg, 'should have notes');
  assert.ok('updated_at' in cfg, 'should have updated_at');
  assert.ok('scanPreferences' in cfg, 'should have scanPreferences');
  assert.ok('privacyManagement' in cfg, 'should have privacyManagement');
});
