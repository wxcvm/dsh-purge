/** Opt-in capture against THREE EXISTING isolated profiles; never edits profiles or installs Purge. */
import fs from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
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

export function capture(config, full = false) {
  const c = validateCaptureConfig(config);
  const out = fs.mkdtempSync(join(resolve('.scratch'), 'task-quality-'));
  const entry = join(out, 'entry.mjs');
  fs.writeFileSync(entry, `import {runDesktopCli} from ${JSON.stringify(pathToFileURL(c.cli).href)}; await runDesktopCli(${JSON.stringify(c.runtime)});`);
  const matrix = { captureKind: 'real', ...Object.fromEntries(['host', 'current', 'candidate'].map(k => [k, { ...c[k], samples: {} }])) };
  const selected = full ? cases : cases.filter(k => ['arithmetic', 'multi-step'].includes(k.id));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: c.dshHome };
  // One model request per case/variant. No automatic retries at collector level.
  for (const task of selected) for (const name of ['host', 'current', 'candidate']) {
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
    const attempt = probe?.items?.[0];
    if (!attempt || attempt.provider + '/' + attempt.model !== c[name].model) throw new Error('actual model route missing/mismatched; partial capture at ' + out);
    const metrics = { elapsedMs: Date.now() - start };
    if (probe.items.every(a => a.usage?.totalTokens != null)) metrics.totalTokens = probe.items.reduce((n, a) => n + a.usage.totalTokens, 0);
    const first = probe.items.at(-1);
    if (first?.firstTextMs != null) metrics.firstTextMs = first.firstTextMs;
    metrics.toolCalls = events.filter(e => e.type === 'tool_call').length;
    matrix[name].samples[task.id] = { response: String(final.text ?? ''), metrics };
    fs.writeFileSync(join(out, 'matrix.json'), JSON.stringify(matrix, null, 2));
  }
  const report = evaluateMatrix(matrix);
  fs.writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return { directory: out, capturedCases: selected.length, modelCalls: selected.length * 3 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, file] = process.argv.slice(2);
    if (!['--preflight', '--smoke', '--full'].includes(mode) || !file) throw new Error('Usage: capture-task-quality.mjs --preflight|--smoke|--full config.json');
    const config = validateCaptureConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (mode === '--preflight') console.log(JSON.stringify({ ok: true, modelCalls: 0, profileSetup: 'existing-only', provenance: 'collector-declared-variant-identity' }));
    else { fs.mkdirSync(resolve('.scratch'), { recursive: true }); console.log(JSON.stringify(capture(config, mode === '--full'))); }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
