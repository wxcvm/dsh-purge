import test from 'node:test';
import assert from 'node:assert/strict';
import { sameDeferredTurn, replacementSummary } from '../lib/runtime-hygiene.js';

const expected = { humanSeq: 1, assistantSeq: 2, endSeq: 3 };
const current = { ...expected, enabled: true, busy: false, freshHuman: false, endKind: 'completed' };

test('only the original completed turn can receive a delayed action', () => {
  assert.equal(sameDeferredTurn(expected, current), true);
  for (const change of [
    { enabled: false }, { busy: true }, { freshHuman: true },
    { humanSeq: 4 }, { assistantSeq: 5 }, { endSeq: 6 },
    { endKind: 'aborted' }, { endKind: 'blocked' }, { endKind: undefined },
  ]) assert.equal(sameDeferredTurn(expected, { ...current, ...change }), false);
});

test('replacement logs contain only counts and known categories', () => {
  const secret = 'https://example.invalid/private-token';
  const result = replacementSummary([
    { kind: 'url', value: secret }, { kind: 'domain', value: 'example.invalid' },
    { kind: 'url', value: secret }, { kind: secret, value: secret },
  ]);
  assert.deepEqual(result, { count: 4, kinds: { url: 2, domain: 1 } });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(replacementSummary([]), { count: 0, kinds: {} });
});
