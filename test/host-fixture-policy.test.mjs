import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HOSTS, FULL_HOST, fixtureDependencies } from '../scripts/host-fixture-policy.mjs';

const metadata = (version, error = false, sandbox = false) => [
  { name: '@deepseek-ai/dsh-tools', version, peerDependencies: {
    '@deepseek-ai/cordis': '~4.1.0', ...(sandbox ? { '@deepseek-ai/dsh-sandbox': version } : {}),
  } },
  { name: '@deepseek-ai/dsh-llm', version, peerDependencies: error ? { '@deepseek-ai/dsh-error': version } : {} },
];

test('rc.3 is the primary fixture and runtime peers come from metadata rather than one hardcoded version', () => {
  assert.equal(FULL_HOST, '0.2.2-rc.3');
  for (const version of ['0.2.2-rc.2', '0.2.2-rc.3']) {
    const dependencies = fixtureDependencies(version, ...metadata(version, true));
    assert.equal(dependencies['@deepseek-ai/dsh-error'], version);
    assert.equal(dependencies['@deepseek-ai/cordis'], '4.1.0');
    for (const [name, pinned] of Object.entries(dependencies)) {
      if (name !== '@deepseek-ai/cordis') assert.equal(pinned, version);
    }
  }
});

test('earlier fixture manifests remain unchanged when their real metadata is reused', () => {
  for (const version of ['0.2.2-rc.1', '0.2.2-rc.2']) {
    const file = new URL('../.scratch/hosts/' + version + '/package.json', import.meta.url);
    // Always test the historical policy, even when no local fixture is installed.
    const expected = fixtureDependencies(version, ...metadata(version, version.endsWith('rc.2')));
    assert.equal(Object.hasOwn(expected, '@deepseek-ai/dsh-error'), version.endsWith('rc.2'));
    if (fs.existsSync(file)) assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).dependencies, expected);
  }
});

test('legacy sandbox pins are preserved without adding sandbox packages to current fixtures', () => {
  const old = fixtureDependencies(HOSTS[0], ...metadata(HOSTS[0], false, true));
  assert.equal(old['@deepseek-ai/dsh-sandbox'], HOSTS[0]);
  assert.equal(old['@deepseek-ai/dsh-sandbox-policy'], HOSTS[0]);
  assert.equal(old['@deepseek-ai/dsh-working-directory'], HOSTS[0]);
  assert.equal(Object.hasOwn(fixtureDependencies(FULL_HOST, ...metadata(FULL_HOST, true)), '@deepseek-ai/dsh-sandbox'), false);
});

test('unknown versions and mismatched or unpinned metadata fail before creating a fixture', () => {
  assert.throws(() => fixtureDependencies('unknown', ...metadata('unknown')), /reviewed/);
  const [tools, llm] = metadata(FULL_HOST, true);
  assert.throws(() => fixtureDependencies(FULL_HOST, { ...tools, version: '0.2.2-rc.2' }, llm), /mismatch/);
  assert.throws(() => fixtureDependencies(FULL_HOST, tools, { ...llm, name: 'other' }), /mismatch/);
  assert.throws(() => fixtureDependencies(FULL_HOST, { ...tools, peerDependencies: { '@deepseek-ai/cordis': '^4.1.0' } }, llm), /exact Cordis/);
  assert.throws(() => fixtureDependencies(FULL_HOST, tools, { ...llm, peerDependencies: { '@deepseek-ai/dsh-error': '^0.2.2' } }), /same-version/);
});
