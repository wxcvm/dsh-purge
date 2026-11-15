import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { RUNTIME_FILES } from '../lib/desktop-runtime-health.js'

const source = readFileSync(new URL('../lib/official-update.wscript', import.meta.url), 'utf8')
const exe = 'C:\\Harness\\Dsh Next.exe'
const resources = 'C:\\Harness\\resources'
const app = resources + '\\app'
const asar = resources + '\\app.asar'
const bak = asar + '.bak'
const installer = 'C:\\Temp\\deepseek-harness-0.2.2-rc.1-win-x64.exe'

function simulate({ stubborn = false, moveFails = false, installCode = 0, changes = true, noArchive = false, autoRestart = false, staleVersion = false, exeOnlyChange = false, numericVersion = false, missingRuntime = false, missingRuntimeFile = null } = {}) {
  const dirs = new Set([resources, app])
  const files = new Map([
    [exe, { size: 10, stamp: 1, version: '0.2.1-rc.5' }],
    [installer, { size: 20, stamp: 1 }],
  ])
  if (!noArchive) files.set(bak, { size: 30, stamp: 1 })
  if (!missingRuntime) for (const rel of RUNTIME_FILES) if (rel !== missingRuntimeFile) files.set(resources + '\\runtime\\' + rel.replaceAll('/', '\\'), { size: 1, stamp: 1 });
  if (numericVersion) { files.get(exe).version = '0.2.0.0'; files.get(exe).releaseVersion = '0.2.1-rc.5'; }
  const calls = []
  const logs = []
  let now = 10000
  let running = true
  let result
  const fso = {
    FileExists: name => files.has(name),
    FolderExists: name => dirs.has(name),
    GetFileName: name => name.split('\\').at(-1),
    GetFileVersion: name => files.get(name)?.version || '',
    GetParentFolderName: name => name.slice(0, name.lastIndexOf('\\')),
    GetFile: name => {
      const f = files.get(name)
      if (!f) throw Error('not found: ' + name)
      return { Size: f.size, DateLastModified: new Date(f.stamp * 1000) }
    },
    CopyFile: (from, to) => {
      if (!files.has(from)) throw Error('copy source missing')
      files.set(to, { ...files.get(from) })
    },
    MoveFolder: (from, to) => {
      if (moveFails && from === app) throw Error('locked app directory')
      if (!dirs.has(from) || dirs.has(to)) throw Error('directory unavailable')
      dirs.delete(from); dirs.add(to)
    },
    DeleteFile: name => { files.delete(name) },
    CreateTextFile: name => ({
      WriteLine: text => { files.set(name, { size: text.length, stamp: 9 }) },
      Close: () => {},
    }),
    OpenTextFile: name => ({
      ReadAll: () => files.get(name)?.text || "",
      WriteLine: text => { logs.push(text) },
      Close: () => {},
    }),
  }
  const shell = {
    CurrentDirectory: 'C:\\Harness',
    Environment: () => ({ Remove: () => {} }),
    Run: (command) => {
      calls.push(command)
      if (command.startsWith('powershell.exe ')) {
        files.set('C:\\Temp\\update.log.file-version.txt', { text: files.get(exe).releaseVersion || files.get(exe).version });
        return 0;
      }
      if (command.startsWith('taskkill.exe ')) {
        if (!stubborn) running = false
        return 0
      }
      if (command.startsWith('"' + installer + '"')) {
        if (changes) {
          if (!exeOnlyChange) files.set(asar, { size: 40, stamp: 2 })
          else files.get(exe).stamp = 2
          if (!staleVersion) { files.get(exe).version = numericVersion ? '0.2.0.1' : '0.2.2-rc.1'; if (numericVersion) files.get(exe).releaseVersion = '0.2.2-rc.1'; }
        }
        if (autoRestart && installCode === 0) running = true
        return installCode
      }
      return 0
    },
  }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  class Enumerator {
    constructor(items) { this.items = items; this.index = 0 }
    atEnd() { return this.index >= this.items.length }
    item() { return this.items[this.index] }
    moveNext() { this.index++ }
  }
  const wmi = {
    ExecQuery: query => {
      assert.match(query, /Name = 'Dsh Next.exe'/)
      return running ? [{ ProcessId: 123, ExecutablePath: exe }] : []
    },
  }
  const context = {
    ActiveXObject: function (name) { return name === 'Scripting.FileSystemObject' ? fso : shell },
    GetObject: () => wmi,
    Enumerator,
    Date: FakeDate,
    WScript: {
      Sleep: ms => { now += ms },
      Quit: code => { throw Object.assign(new Error('quit'), { exitCode: code }) },
    },
  }
  const replacements = {
    __EXE_JSON__: JSON.stringify(exe),
    __INSTALLER_JSON__: JSON.stringify(installer),
    __RESOURCES_JSON__: JSON.stringify(resources),
    __INSTALL_DIR_JSON__: JSON.stringify('C:\\Harness'),
    __LOG_JSON__: JSON.stringify('C:\\Temp\\update.log'),
  }
  let script = source
  for (const [placeholder, value] of Object.entries(replacements)) script = script.replaceAll(placeholder, value)
  try { vm.runInNewContext(script, context, { timeout: 2000 }) }
  catch (error) {
    if (error.exitCode !== undefined) result = error.exitCode
    else throw error
  }
  return { dirs, files, calls, logs: logs.join('\n'), exitCode: result, cwd: shell.CurrentDirectory }
}

test('WSH updater uses current Harness executable name and stops before modifying a live installation', () => {
  const run = simulate({ stubborn: true })
  assert.equal(run.exitCode, 1)
  assert.match(run.logs, /abort: desktop still running/)
  assert.ok(run.dirs.has(app))
  assert.ok(run.files.has(bak))
  assert.ok(!run.calls.some(x => x.includes(installer)))
})

test('locked resources/app aborts instead of running NSIS against the patched host', () => {
  const run = simulate({ moveFails: true })
  assert.equal(run.exitCode, 1)
  assert.match(run.logs, /abort: patched app directory could not be moved/)
  assert.ok(run.dirs.has(app))
  assert.ok(!run.calls.some(x => x.includes(installer)))
})

test('nonzero installer exit is a failure even if app.asar changed', () => {
  const run = simulate({ installCode: 3, changes: true })
  assert.match(run.logs, /abort: installer exit=3/)
  assert.match(run.logs, /manual-recovery-required/)
  assert.equal(run.exitCode, 1)
  assert.equal(run.dirs.has(app), false, 'old unpacked application must not replace new version')
  assert.ok(run.dirs.has(app + '.dshpurge-prev'), 'previous app preserved')
  assert.equal(run.files.has(asar), true, 'current archive preserved')
  assert.equal(run.calls.filter(x => x === '"' + exe + '"').length, 0, 'do not relaunch mixed installation')
  assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), false)
  assert.equal(run.calls.filter(x => x.includes(installer)).length, 1, 'do not run the installer twice after partial changes')
})

test('successful install preserves updated archive and requests patch reapplication', () => {
  const run = simulate()
  assert.equal(run.files.has(asar), true)
  assert.equal(run.dirs.has(app), false)
  assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), true)
  assert.match(run.logs, /started/)
  assert.equal(run.cwd, 'C:\\Temp', 'the detached updater must leave the installation directory')
  const commands = run.calls.filter(x => x.startsWith('"' + installer + '"'))
  assert.deepEqual(commands, ['"' + installer + '" --updated /S --force-run'])
})

test('missing original archive aborts and restores extracted host', () => {
  const run = simulate({ noArchive: true })
  assert.equal(run.exitCode, 1)
  assert.match(run.logs, /abort: no official app.asar available/)
  assert.ok(run.dirs.has(app))
  assert.ok(!run.calls.some(x => x.includes(installer)))
})

test('WSH source remains ASCII so its path literals work on non-English Windows', () => {
  assert.ok([...source].every(c => c.charCodeAt(0) <= 127))
})


test('installer reporting success without changing the installed payload is not accepted as an update', () => {
  const run = simulate({ changes: false })
  assert.match(run.logs, /abort: installer exit=0 changed=false/)
  assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), false)
  assert.ok(run.dirs.has(app), 'original patched application must be restored')
  assert.equal(run.calls.filter(x => x.startsWith('"' + installer + '"')).length, 1)
})

test('updater does not start a duplicate Harness when NSIS already relaunched it', () => {
  const run = simulate({ autoRestart: true })
  assert.match(run.logs, /installer-restarted/)
  assert.equal(run.calls.filter(x => x === '"' + exe + '"').length, 0)
})

test('handoff patch does not substitute installer.exe when verified pending metadata exists', () => {
  const core = readFileSync(new URL('../lib/core.js', import.meta.url), 'utf8')
  assert.match(core, /desktop verified pending installer missing/)
  assert.match(core, /const infoPath = join\(cache,/)
  assert.match(core, /if \(existsSync\(infoPath\)\)/)
  assert.match(core, /cwd: process\.env\.TEMP \|\| dirname\(installer\)/)
})


test('changed files do not count as an upgrade if executable version remains old', () => {
  const run = simulate({ staleVersion: true })
  assert.match(run.logs, /version before=0\.2\.1-rc\.5 target=0\.2\.2-rc\.1 after=0\.2\.1-rc\.5 match=false/)
  assert.match(run.logs, /abort: installer exit=0 changed=true/)
  assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), false)
  assert.ok(run.dirs.has(app), 'keep previous patched host usable')
})


test('updating only the exe without replacing app.asar is not a complete upgrade', () => {
  const run = simulate({ exeOnlyChange: true })
  assert.match(run.logs, /changed exe=true asar=false/)
  assert.match(run.logs, /abort: installer exit=0 changed=true/)
  assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), false)
  assert.equal(run.dirs.has(app), false)
  assert.ok(run.dirs.has(app + '.dshpurge-prev'))
  assert.match(run.logs, /manual-recovery-required/)
  assert.equal(run.exitCode, 1)
})

test('real Windows numeric PE tuple does not reject a matching prerelease string', () => {
  const run = simulate({ numericVersion: true });
  assert.match(run.logs, /after=0\.2\.2-rc\.1 match=true/);
  assert.ok(run.files.has(resources + '\\dsh-purge-reapply-asar'));
});
test('installer success without its runtime payload is not accepted', () => {
  const run = simulate({ missingRuntime: true });
  assert.match(run.logs, /runtime-ready=false/);
  assert.ok(!run.files.has(resources + '\\dsh-purge-reapply-asar'));
});

test('all six runtime files required by the diagnostic must also pass the installer handoff', () => {
  for (const rel of RUNTIME_FILES) {
    const run = simulate({ missingRuntimeFile: rel });
    assert.match(run.logs, /runtime-ready=false/);
    assert.ok(run.logs.includes(rel.replaceAll('/', '\\')));
    assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), false);
    assert.match(run.logs, /manual-recovery-required/);
    assert.equal(run.exitCode, 1);
  }
});
