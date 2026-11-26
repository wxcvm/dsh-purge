import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
function extract(source) {
  const start = source.indexOf('    function buildSensitiveRemediationSummary(');
  const end = source.indexOf('    function SensitiveIntelTab(', start);
  assert.ok(start >= 0 && end > start);
  return runInNewContext(source.slice(start, end) + '\nbuildSensitiveRemediationSummary');
}
const capturedAt = '2026-11-24T05:00:00.000Z';
const summary = { total: 5, unreviewed: 1, reviewing: 2, confirmed: 1, falsePositive: 0, resolved: 1 };
for (const path of ['../lib/redteam/client.js', '../client.js']) {
  const source = read(path);
  const build = extract(source);
  test(path + ' exports only a versioned aggregate snapshot', () => {
    const actual = JSON.parse(JSON.stringify(build({
      ...summary, host: 'hidden.test', secret: 'secret-value', evidenceRefs: 1, highPrivilege: 3,
    }, capturedAt)));
    assert.deepEqual(actual, {
      schema: 'purge.remediation-summary.v1', capturedAt,
      counts: { total: 5, pending: 1, reviewing: 2, confirmed: 1, falsePositive: 0, resolved: 1 },
    });
    assert.equal(build({ ...summary, total: 6 }, capturedAt), null);
    assert.equal(build({ ...summary, resolved: -1 }, capturedAt), null);
    assert.equal(build(summary, 'yesterday'), null);
    assert.equal(build({ total: 0, unreviewed: 0, reviewing: 0, confirmed: 0, falsePositive: 0, resolved: 0 }, capturedAt).counts.total, 0);
  });
  test(path + ' gates display, local export and review on temporary asset masking', () => {
    const start = source.indexOf('    function SensitiveIntelTab(');
    const end = source.indexOf('    function AssetsTab(', start);
    const view = source.slice(start, end);
    assert.match(view, /useTemporaryPrivacy\(\)\?\.maskAssetResults/);
    assert.match(view, /!masked && state\.data\?\.engagement === eng/);
    assert.match(view, /if \(!shareSummary \|\| masked\) return/);
    assert.match(view, /if \(!eng \|\| masked\)/);
  });
}
