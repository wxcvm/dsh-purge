import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportEngagementReport, parseReportExportArgs, writeReportBundle } from '../lib/redteam/report-export.js';
import { main } from '../scripts/export-engagement-report.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-report-export-'));
  t.after(() => {
    const resolved = path.resolve(base);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('dsh-report-export-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const root = path.join(base, 'store');
  const engagement = 'synthetic-example';
  const dir = path.join(root, 'engagements', engagement);
  fs.mkdirSync(dir, { recursive: true });
  const outDir = path.join(base, 'output');
  return { base, root, engagement, dir, outDir };
}
function report(refs = []) {
  return {
    target: 'Synthetic evidence', summary: { points: 3 },
    markdown: '# Inert report\n\n' + refs.map((ref) => `![Synthetic](${ref})`).join('\n') + '\n',
    items: [{ shots: refs.map((url) => ({ url })) }],
  };
}
function addFile(f, relative, data = 'inert synthetic evidence') {
  const file = path.join(f.dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}
function makeLink(t, source, target, type) {
  try { fs.symlinkSync(source, target, type); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('This account cannot create symbolic links'); return false; }
    throw error;
  }
  return true;
}

test('argument parsing supports explicit paths, equals syntax and legacy defaults', () => {
  const cwd = path.resolve('argument-test');
  assert.deepEqual(parseReportExportArgs(['--root', 'db', '--engagement=sample', '--out', 'delivery'], {}, cwd), {
    root: path.join(cwd, 'db'), engagement: 'sample', outDir: path.join(cwd, 'delivery'), help: false,
  });
  assert.equal(parseReportExportArgs([], { REDTEAM_HOME: 'custom' }, cwd).root, path.join(cwd, 'custom'));
  assert.equal(parseReportExportArgs([], { DSH_HOME: 'home' }, cwd).root, path.join(cwd, 'home', 'redteam'));
  assert.equal(parseReportExportArgs([], {}, cwd).root, path.join(os.homedir(), '.dsh', 'redteam'));
  assert.equal(parseReportExportArgs(['--out=~/delivery'], {}, cwd).outDir, path.join(os.homedir(), 'delivery'));
});

test('argument parsing rejects unknown, duplicated and missing values', () => {
  for (const args of [['--unknown'], ['stray'], ['--root'], ['--out', '--root', 'db'], ['--engagement='], ['--root=a', '--root=b']]) {
    assert.throws(() => parseReportExportArgs(args, {}));
  }
});

test('help neither creates nor opens a store', async (t) => {
  const f = fixture(t);
  const missing = path.join(f.base, 'nonexistent');
  const logs = [];
  await main(['--help', '--root', missing, '--out', f.outDir], {
    createStore() { throw new Error('must not open'); }, log: (line) => logs.push(line),
  });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /--root/);
  assert.equal(fs.existsSync(missing), false);
  assert.equal(fs.existsSync(f.outDir), false);
});

test('CLI module import is inert, including nonexistent REDTEAM_HOME', (t) => {
  const f = fixture(t);
  const missing = path.join(f.base, 'nonexistent');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../scripts/export-engagement-report.mjs', import.meta.url).href)});`], {
    cwd: f.base, env: { ...process.env, REDTEAM_HOME: missing }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(fs.existsSync(missing), false);
  assert.equal(fs.existsSync(path.join(f.base, 'shots')), false);
});

test('bundle preserves existing output, copies scoped evidence only, and verifies SHA-256', (t) => {
  const f = fixture(t);
  addFile(f, 'shots/selected.png', Buffer.from([0, 1, 2, 3, 255]));
  addFile(f, 'shots/nested/second.txt', 'second inert fixture');
  addFile(f, 'shots/unreferenced.txt', 'do not export');
  fs.mkdirSync(path.join(f.outDir, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(f.outDir, 'shots', 'unrelated.txt'), 'keep screenshot');
  fs.writeFileSync(path.join(f.outDir, 'Synthetic evidence-红队成果复现报告.md'), 'keep report');
  const rep = report(['shots/selected.png', 'shots/nested/second.txt', 'shots/selected.png']);
  const result = writeReportBundle({ ...f, report: rep });
  assert.equal(path.dirname(result.bundleDir), f.outDir);
  assert.equal(fs.readFileSync(result.reportFile, 'utf8'), rep.markdown);
  assert.equal(fs.readFileSync(path.join(f.outDir, 'shots', 'unrelated.txt'), 'utf8'), 'keep screenshot');
  assert.equal(fs.readFileSync(path.join(f.outDir, 'Synthetic evidence-红队成果复现报告.md'), 'utf8'), 'keep report');
  assert.equal(fs.existsSync(path.join(result.bundleDir, 'shots', 'unreferenced.txt')), false);
  const manifest = JSON.parse(fs.readFileSync(result.manifestFile, 'utf8'));
  assert.deepEqual(manifest, result.manifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.engagementId, f.engagement);
  assert.equal(manifest.summary.evidenceFiles, 2);
  assert.equal(manifest.files.length, 3);
  for (const entry of manifest.files) {
    assert.ok(!entry.path.includes('\\'));
    const bytes = fs.readFileSync(path.join(result.bundleDir, ...entry.path.split('/')));
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  const again = writeReportBundle({ ...f, report: rep });
  assert.notEqual(again.bundleDir, result.bundleDir);
  assert.equal(fs.readFileSync(result.reportFile, 'utf8'), rep.markdown);
});

test('reports without evidence need no shots directory and sanitize filenames', (t) => {
  const f = fixture(t);
  const rep = report();
  rep.target = 'CON/invalid:*?<>|. ';
  const result = writeReportBundle({ ...f, report: rep });
  assert.equal(result.manifest.summary.evidenceFiles, 0);
  assert.equal(result.manifest.files.length, 1);
  assert.equal(fs.existsSync(path.join(result.bundleDir, 'shots')), false);
  assert.ok(!/[<>:"/\\|?*]/.test(path.basename(result.reportFile)));
});

test('missing, directory, malformed and unscoped evidence fail before output creation', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.dir, 'shots', 'directory'), { recursive: true });
  for (const ref of ['shots/missing.png', 'shots/directory', '../outside.txt', 'shots/../../outside.txt', 'shots//file.png',
    'shots/../file.png', 'shots/C:alternate', 'shots/CON', 'shots/file.', 'shots/%2e%2e/outside', 'shots/a#fragment',
    'shots\\outside', '/absolute.png', 'https://example.test/a.png', 'shots/']) {
    assert.throws(() => writeReportBundle({ ...f, report: report([ref]) }), undefined, ref);
    assert.equal(fs.existsSync(f.outDir), false, ref);
  }
});

test('engagement traversal and portable-invalid IDs are rejected', (t) => {
  const f = fixture(t);
  for (const engagement of ['../escape', '..', '.', 'a/b', 'a\\b', 'x:ads', 'NUL', 'id.']) {
    assert.throws(() => writeReportBundle({ ...f, engagement, report: report() }));
  }
  assert.equal(fs.existsSync(f.outDir), false);
});

test('case-colliding evidence references are rejected without creating output', (t) => {
  const f = fixture(t);
  addFile(f, 'shots/example.png');
  assert.throws(() => writeReportBundle({ ...f, report: report(['shots/example.png', 'shots/EXAMPLE.png']) }), /冲突/);
  assert.equal(fs.existsSync(f.outDir), false);
});

test('leaf symlink/junction evidence is rejected', (t) => {
  const f = fixture(t);
  const outside = path.join(f.base, 'outside');
  fs.mkdirSync(outside);
  const source = path.join(outside, 'evidence.txt');
  fs.writeFileSync(source, 'outside content');
  fs.mkdirSync(path.join(f.dir, 'shots'));
  // Windows junctions exercise lstat.isSymbolicLink without administrator privileges.
  // POSIX exercises a file symlink; Windows exercises the same rejection at a leaf junction.
  const windows = process.platform === 'win32';
  if (!makeLink(t, windows ? outside : source, path.join(f.dir, 'shots', 'linked.txt'), windows ? 'junction' : 'file')) return;
  assert.throws(() => writeReportBundle({ ...f, report: report(['shots/linked.txt']) }), /不是普通文件/);
  assert.equal(fs.existsSync(f.outDir), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'outside content');
});

test('source intermediate junction/symlink is rejected', (t) => {
  const f = fixture(t);
  const outside = path.join(f.base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'linked.txt'), 'outside content');
  if (!makeLink(t, outside, path.join(f.dir, 'shots'), process.platform === 'win32' ? 'junction' : 'dir')) return;
  assert.throws(() => writeReportBundle({ ...f, report: report(['shots/linked.txt']) }), /符号链接/);
  assert.equal(fs.existsSync(f.outDir), false);
});

test('destination junction/symlink is rejected without writing through it', (t) => {
  const f = fixture(t);
  const outside = path.join(f.base, 'outside');
  fs.mkdirSync(outside);
  if (!makeLink(t, outside, f.outDir, process.platform === 'win32' ? 'junction' : 'dir')) return;
  assert.throws(() => writeReportBundle({ ...f, report: report() }), /符号链接/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('late write failure removes only owned partial files, not preexisting output', (t) => {
  const f = fixture(t);
  addFile(f, 'shots/selected.txt');
  fs.mkdirSync(f.outDir);
  fs.writeFileSync(path.join(f.outDir, 'untouched.txt'), 'keep');
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', function (file, ...args) {
    if (typeof file === 'string' && path.basename(file) === 'manifest.json') throw new Error('synthetic manifest failure');
    return open.call(this, file, ...args);
  });
  assert.throws(() => writeReportBundle({ ...f, report: report(['shots/selected.txt']) }), /synthetic manifest failure/);
  assert.deepEqual(fs.readdirSync(f.outDir), ['untouched.txt']);
  assert.equal(fs.readFileSync(path.join(f.outDir, 'untouched.txt'), 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(f.dir, 'shots', 'selected.txt'), 'utf8'), 'inert synthetic evidence');
});

test('cleanup preserves unexpected files inserted into a partial bundle', (t) => {
  const f = fixture(t);
  const open = fs.openSync;
  let leftover;
  t.mock.method(fs, 'openSync', function (file, ...args) {
    if (typeof file === 'string' && path.basename(file) === 'manifest.json') {
      leftover = path.join(path.dirname(file), 'unexpected.txt');
      fs.writeFileSync(leftover, 'not owned by exporter');
      throw new Error('synthetic failure');
    }
    return open.call(this, file, ...args);
  });
  assert.throws(() => writeReportBundle({ ...f, report: report() }), (error) => error instanceof AggregateError && /部分文件保留于/.test(error.message));
  assert.equal(fs.readFileSync(leftover, 'utf8'), 'not owned by exporter');
  assert.deepEqual(fs.readdirSync(path.dirname(leftover)), ['unexpected.txt']);
});

test('export wrapper closes its store after success and all post-open failures', async (t) => {
  const f = fixture(t);
  for (const mode of ['success', 'missing-active', 'report-error', 'export-error']) {
    let closed = 0;
    let called = 0;
    const createStore = (directory) => {
      assert.equal(directory, f.root);
      return {
        activeEngagementId: () => mode === 'missing-active' ? null : f.engagement,
        scoreReport(id, options) {
          called++;
          assert.equal(id, f.engagement);
          assert.deepEqual(options, { shotRef: 'relative' });
          if (mode === 'report-error') throw new Error('synthetic report failure');
          return report(mode === 'export-error' ? ['shots/missing.txt'] : []);
        },
        close() { closed++; },
      };
    };
    const promise = exportEngagementReport({ root: f.root, outDir: f.outDir }, { createStore });
    if (mode === 'success') assert.ok((await promise).manifestFile);
    else await assert.rejects(promise);
    assert.equal(closed, 1, mode);
    assert.equal(called, mode === 'missing-active' ? 0 : 1, mode);
  }
});

test('invalid roots and explicit invalid engagements do not open or create stores', async (t) => {
  const f = fixture(t);
  const missing = path.join(f.base, 'missing');
  const createStore = () => { throw new Error('unexpected store open'); };
  await assert.rejects(exportEngagementReport({ root: missing }, { createStore }), { code: 'ENOENT' });
  await assert.rejects(exportEngagementReport({ root: f.root, engagement: '../escape' }, { createStore }), /engagement/);
  assert.equal(fs.existsSync(missing), false);
});

test('CLI reports bundle location and returns nonzero on invalid arguments', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['scripts/export-engagement-report.mjs', '--unknown'], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未知参数/);
  assert.equal(fs.existsSync(f.outDir), false);
});

test('source mutation during streaming fails and cleans the incomplete bundle', (t) => {
  const f = fixture(t);
  const selected = addFile(f, 'shots/selected.txt', Buffer.alloc(128 * 1024, 7));
  const read = fs.readSync;
  let mutated = false;
  t.mock.method(fs, 'readSync', function (...args) {
    const count = read.apply(this, args);
    if (!mutated) { mutated = true; fs.appendFileSync(selected, 'changed'); }
    return count;
  });
  assert.throws(() => writeReportBundle({ ...f, report: report(['shots/selected.txt']) }), /复制时发生变化/);
  assert.deepEqual(fs.readdirSync(f.outDir), []);
});

test('store close failures retain the original report error in an AggregateError', async (t) => {
  const f = fixture(t);
  const createStore = () => ({
    activeEngagementId: () => f.engagement,
    scoreReport() { throw new Error('original report error'); },
    close() { throw new Error('close error'); },
  });
  await assert.rejects(exportEngagementReport({ root: f.root, outDir: f.outDir }, { createStore }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map((item) => item.message), ['original report error', 'close error']);
    return true;
  });
});

test('explicit engagement selection overrides active selection and CLI returns the bundle', async (t) => {
  const f = fixture(t);
  let closed = false;
  const logs = [];
  const result = await main(['--root', f.root, '--engagement', f.engagement, '--out', f.outDir], {
    createStore: () => ({
      activeEngagementId() { throw new Error('explicit selection must not query active'); },
      scoreReport: (id) => { assert.equal(id, f.engagement); return report(); },
      close() { closed = true; },
    }),
    log: (message) => logs.push(message),
  });
  assert.equal(closed, true);
  assert.equal(result.manifest.engagementId, f.engagement);
  assert.ok(logs.some((line) => line.includes(result.reportFile)));
  assert.ok(logs.some((line) => line.includes(result.manifestFile)));
});
