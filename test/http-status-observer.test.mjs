import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectHttpStatuses } from '../lib/workspace/http-status-panel.js';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const generator = readFileSync(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8');

test('HTTP comparison preserves real 403 and errors even when local display is simulated as 200', () => {
  const real = { items: [
    { httpStatus: 403, errorCode: 'FORBIDDEN', reasonSource: 'host-stream', finish: 'error', turnOutcome: 'error',
      privateBody: 'API_KEY_SECRET', provider: 'sensitive-private-provider' },
    { httpStatus: 200, errorCode: null, reasonSource: 'host-stream', finish: 'stop' },
    { httpStatus: null, errorCode: 'CONTENT_REFUSED', reasonSource: 'durable-stream', finish: 'error' },
    { httpStatus: 401, errorCode: 'AUTH', reasonSource: 'host-stream', finish: 'error' },
  ] };
  const normal = projectHttpStatuses(real);
  const simulated = projectHttpStatuses(real, true);
  assert.equal(normal[0].rawStatus, 403);
  assert.equal(normal[0].displayedStatus, 403);
  assert.equal(simulated[0].rawStatus, 403);
  assert.equal(simulated[0].displayedStatus, 200);
  assert.equal(simulated[0].errorCode, 'FORBIDDEN');
  assert.equal(simulated[0].finish, 'error');
  assert.equal(simulated[0].turnOutcome, 'error');
  assert.equal(simulated[1].rawStatus, 200);
  assert.equal(simulated[2].rawStatus, null);
  assert.equal(simulated[2].errorCode, 'CONTENT_REFUSED');
  assert.equal(simulated[3].displayedStatus, 401);
  assert.equal(real.items[0].httpStatus, 403);
  assert.equal('privateBody' in simulated[0], false);
  assert.equal('provider' in simulated[0], false);
  assert.doesNotMatch(JSON.stringify(simulated), /SECRET|sensitive-private-provider/);
});

test('missing or untrusted metadata is not promoted to a known HTTP result', () => {
  const data = { items: [
    { httpStatus: '403', errorCode: 'Bearer secret', finish: 'custom' },
    { httpStatus: 999, errorCode: 'UPSTREAM/OTHER', reasonSource: 'unknown' },
    null,
  ] };
  const projected = projectHttpStatuses(data, true);
  assert.deepEqual(projected.map(row => row.rawStatus), [null, null, null]);
  assert.deepEqual(projected.map(row => row.displayedStatus), [null, null, null]);
  assert.equal(projected[0].errorCode, null);
  assert.equal(projected[1].errorCode, 'UPSTREAM/OTHER');
  assert.equal(projected[1].reasonSource, 'not-observed');
  assert.equal(projected[0].finish, 'unknown');
  assert.deepEqual(projectHttpStatuses(null), []);
  assert.equal(projectHttpStatuses({ items: Array.from({ length: 60 }, () => ({ httpStatus: 403 })) }).length, 50);
});

test('dedicated diagnostics tab uses existing read-only runtime endpoint and generated panel', () => {
  const settings = source.slice(source.indexOf('function SettingsRoot(props)'), source.indexOf('const REWIND_CSS'));
  assert.match(settings, /\["http", "HTTP 响应观察"\]/);
  assert.match(settings, /h\(HttpStatusObservationPanel, \{ onNavigate: navigate, active: section === "diagnostics" && diagnosticsPane === "http" \}\)/);
  assert.match(settings, /if \(next === "http-status"\)/);
  assert.match(source, /function HttpStatusObservationPanel\(/);
  assert.match(source, /function projectHttpStatuses\(/);
  assert.match(generator, /http-status-panel\.js/);
  const panel = readFileSync(new URL('../lib/workspace/http-status-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /\/dsh-purge\/runtime-observations\?limit=50/);
  assert.match(panel, /credentials: 'same-origin'/);
  assert.match(panel, /!active/);
  assert.match(panel, /controller\?\.abort\(\)/);
  assert.match(panel, /本地模拟将 403 显示为 200/);
  assert.match(panel, /不会被改写成网络 200/);
  assert.doesNotMatch(panel, /method:\s*['"]POST['"]|writeHead\(200|Response\(|res\.status\s*=/);
});
