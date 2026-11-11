import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/official-update.wscript', import.meta.url), 'utf8')
const exe = 'C:\\Harness\\Dsh Next.exe'
const resources = 'C:\\Harness\\resources'
const app = resources + '\\app'
const asar = resources + '\\app.asar'
const bak = asar + '.bak'
const installer = 'C:\\Temp\\installer.exe'

function simulate({ stubborn = false, moveFails = false, installCode = 0, changes = true, noArchive = false } = {}) {
  const dirs = new Set([resources, app])
  const files = new Map([
    [exe, { size: 10, stamp: 1 }],
    [installer, { size: 20, stamp: 1 }],
  ])
  if (!noArchive) files.set(bak, { size: 30, stamp: 1 })
  const calls = []
  const logs = []
  let now = 10000
  let running = true
  let result
  const fso = {
    FileExists: name => files.has(name),
    FolderExists: name => dirs.has(name),
    GetFileName: name => name.split('\\').at(-1),
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
    OpenTextFile: () => ({
      WriteLine: text => { logs.push(text) },
      Close: () => {},
    }),
  }
  const shell = {
    Environment: () => ({ Remove: () => {} }),
    Run: (command) => {
      calls.push(command)
      if (command.startsWith('taskkill.exe ')) {
        if (!stubborn) running = false
        return 0
      }
      if (command.startsWith('"' + installer + '"')) {
        if (changes) files.set(asar, { size: 40, stamp: 2 })
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
    ActiveXObject: name => name === 'Scripting.FileSystemObject' ? fso : shell,
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
  return { dirs, files, calls, logs: logs.join('\n'), exitCode: result }
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
  assert.ok(run.dirs.has(app), 'previous patched host restored')
  assert.equal(run.files.has(asar), false, 'prepared asar hidden after failure')
  assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), false)
  assert.equal(run.calls.filter(x => x.includes(installer)).length, 1, 'do not run the installer twice after partial changes')
})

test('successful install preserves updated archive and requests patch reapplication', () => {
  const run = simulate()
  assert.equal(run.files.has(asar), true)
  assert.equal(run.dirs.has(app), false)
  assert.equal(run.files.has(resources + '\\dsh-purge-reapply-asar'), true)
  assert.match(run.logs, /started/)
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
