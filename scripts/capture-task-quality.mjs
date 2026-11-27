/** Opt-in capture against THREE EXISTING isolated profiles; never edits profiles or installs Purge. */
import fs from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { cases, evaluateMatrix } from './evaluate-task-quality.mjs';

export function validateCaptureConfig(c) {
  for (const key of ['exe', 'cli', 'dshHome', 'runtime']) if (!isAbsolute(c?.[key] || '') || !fs.existsSync(c[key])) throw new Error('existing absolute path required: ' + key);
  for (const name of ['host', 'current', 'candidate']) {
    const g = c[name];
    if (!g || !/^[\w-]+$/.test(g.profile || '') || !fs.existsSync(join(c.dshHome, 'profiles', g.profile, 'package.json'))) throw new Error('existing isolated profile required: ' + name);
    if (['default', 'desktop', 'web'].includes(g.profile)) throw new Error('capture must not use a production profile');
    for (const key of ['variant', 'model', 'hostVersion', 'environment']) if (typeof g[key] !== 'string' || !g[key].trim()) throw new Error(name + ' requires ' + key);
    if (!g.settings || typeof g.settings !== 'object') throw new Error(name + ' requires settings');
  }
  if (new Set(['host', 'current', 'candidate'].map(k => c[k].profile)).size !== 3) throw new Error('three distinct existing profiles required');
  const matrix = Object.fromEntries(['host', 'current', 'candidate'].map(k => [k, { ...c[k], samples: {} }]));
  evaluateMatrix({ captureKind: 'real', ...matrix });
  return c;
}

/** Validate observed routes across all retained attempts; absent evidence is not a zero. */
export function captureMetrics(probe, expectedRoute, elapsedMs, events) {
  const items = probe?.items;
  if (!Array.isArray(items) || !items.length || items.some(a => !a.provider || !a.model || a.provider + '/' + a.model !== expectedRoute)) {
    throw new Error('actual model route missing/mismatched');
  }
  const metrics = { elapsedMs };
  // The probe defaults to a bounded snapshot. Do not present partial usage as total usage.
  const complete = probe.evicted === 0 && probe.frames?.start === items.length;
  if (complete && items.every(a => Number.isFinite(a.usage?.totalTokens) && a.usage.totalTokens >= 0)) {
    metrics.totalTokens = items.reduce((n, a) => n + a.usage.totalTokens, 0);
  }
  const first = items.at(-1);
  if (complete && Number.isFinite(first.firstTextMs) && first.firstTextMs >= 0) metrics.firstTextMs = first.firstTextMs;
  metrics.toolCalls = events.filter(e => e.type === 'tool_call').length;
  return metrics;
}

// Reuse only completed samples from a compatible, explicitly supplied real matrix.
// The caller still verifies installed variant identity; metadata is collector-declared.
export function planCapture(c, full = false, previous = null) {
  const names = ['host', 'current', 'candidate'];
  const selected = full ? cases : cases.filter(k => ['arithmetic', 'multi-step'].includes(k.id));
  const matrix = { captureKind: 'real', ...Object.fromEntries(names.map(k => [k, { ...c[k], samples: {} }])) };
  if (previous !== null) {
    if (previous.captureKind !== 'real') throw new Error('resume requires a real capture matrix');
    evaluateMatrix(previous);
    for (const name of names) {
      for (const key of ['profile', 'variant', 'model', 'hostVersion', 'environment', 'settings']) {
        if (!isDeepStrictEqual(previous[name][key], c[name][key])) throw new Error('resume comparison mismatch: ' + name + '.' + key);
      }
      matrix[name].samples = { ...previous[name].samples };
    }
  }
  const pending = selected.flatMap(task => names.filter(name => !Object.hasOwn(matrix[name].samples, task.id)).map(name => ({ task, name })));
  return { matrix, selected, pending, reusedSamples: selected.length * names.length - pending.length };
}

export function capture(config, full = false, previous = null) {
  const c = validateCaptureConfig(config);
  const { matrix, selected, pending, reusedSamples } = planCapture(c, full, previous);
  fs.mkdirSync(resolve('.scratch'), { recursive: true });
  const out = fs.mkdtempSync(join(resolve('.scratch'), 'task-quality-'));
  const entry = join(out, 'entry.mjs');
  fs.writeFileSync(entry, `import {runDesktopCli} from ${JSON.stringify(pathToFileURL(c.cli).href)}; await runDesktopCli(${JSON.stringify(c.runtime)});`);
  fs.writeFileSync(join(out, 'matrix.json'), JSON.stringify(matrix, null, 2));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: c.dshHome };
  // One CLI run per missing case/variant. The host may perform multiple model attempts.
  // No automatic retries at collector level. Keep the source matrix untouched.
  for (const { task, name } of pending) {
    const observation = join(out, name + '-' + task.id + '-metadata.json');
    const overlay = join(out, name + '-' + task.id + '-overlay.json');
    fs.writeFileSync(overlay, JSON.stringify([{ insert: [{ id: 'purge-runtime-observation-probe', name: resolve('scripts/runtime-observation-probe.mjs'), config: { output: observation } }] }]));
    const start = Date.now();
    const r = spawnSync(c.exe, ['--expose-internals', entry, '--profile', c[name].profile, '--patch', overlay,
      '--permission-mode', 'read-only', '--approval-policy', 'never', '--json', task.prompt],
    { cwd: out, env, windowsHide: true, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    const events = String(r.stdout || '').split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
    const final = events.findLast(e => e.type === 'final');
    if (r.status !== 0 || final?.reason?.kind !== 'completed') {
      fs.writeFileSync(join(out, 'incomplete.json'), JSON.stringify({ variant: name, case: task.id, exit: r.status, error: r.error?.code || null, reason: final?.reason?.kind || null }));
      throw new Error('capture stopped on failed/incomplete run; partial observations retained at ' + out);
    }
    const probe = fs.existsSync(observation) ? JSON.parse(fs.readFileSync(observation, 'utf8')) : null;
    let metrics;
    try { metrics = captureMetrics(probe, c[name].model, Date.now() - start, events); }
    catch (error) {
      fs.writeFileSync(join(out, 'incomplete.json'), JSON.stringify({ variant: name, case: task.id, reason: error.message }));
      throw new Error(error.message + '; partial capture at ' + out);
    }
    matrix[name].samples[task.id] = { response: String(final.text ?? ''), metrics };
    fs.writeFileSync(join(out, 'matrix.json'), JSON.stringify(matrix, null, 2));
  }
  const report = evaluateMatrix(matrix);
  fs.writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return { directory: out, capturedCases: selected.length, reusedSamples, newRuns: pending.length, modelCalls: pending.length, modelCallsMeaning: 'collector CLI runs; actual provider attempts may differ' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, file, ...rest] = process.argv.slice(2);
    if (!['--preflight', '--smoke', '--full'].includes(mode) || !file || (rest.length !== 0 && (rest.length !== 2 || rest[0] !== '--resume' || !rest[1]))) throw new Error('Usage: capture-task-quality.mjs --preflight|--smoke|--full config.json [--resume matrix.json]');
    const config = validateCaptureConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    const previous = rest.length ? JSON.parse(fs.readFileSync(rest[1], 'utf8')) : null;
    if (mode === '--preflight') {
      const plan = planCapture(config, true, previous);
      console.log(JSON.stringify({ ok: true, modelCalls: 0, remainingRuns: plan.pending.length, reusedSamples: plan.reusedSamples, profileSetup: 'existing-only', provenance: 'collector-declared-variant-identity' }));
    } else console.log(JSON.stringify(capture(config, mode === '--full', previous)));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
