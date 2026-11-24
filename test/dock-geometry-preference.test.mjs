import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('const DOCK_GEOM_KEY =')
const end = source.indexOf('function WelcomeNotice(', start)
assert.ok(start >= 0 && end > start)
const makeHook = new Function('window', 'useState', 'useEffect', source.slice(start, end) + '\nreturn useDockGeometry')
const key = 'dsh-purge-dock-geom-v4'
const wide = { x: 495, y: 145, w: 835, h: 595 }

function setup(initial, width = 1440, height = 900, { blocked = false } = {}) {
  const storage = new Map(initial ? [[key, JSON.stringify(initial)]] : [])
  const events = new EventTarget()
  const window = {
    innerWidth: width, innerHeight: height,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    localStorage: {
      getItem(name) { if (blocked) throw Error('storage denied'); return storage.get(name) || null },
      setItem(name, value) { if (blocked) throw Error('storage denied'); writes++; storage.set(name, value) },
    },
  }
  let i = 0, writes = 0
  const hooks = [], effects = []
  const useState = (initial) => {
    const id = i++
    if (!(id in hooks)) hooks[id] = typeof initial === 'function' ? initial() : initial
    return [hooks[id], next => { hooks[id] = typeof next === 'function' ? next(hooks[id]) : next }]
  }
  const useEffect = (cb, deps) => {
    const id = i++
    const prev = hooks[id]
    if (!prev || deps.some((dep, index) => !Object.is(dep, prev.deps[index]))) {
      effects.push(() => { prev?.cleanup?.(); hooks[id] = { deps, cleanup: cb() } })
    }
  }
  const hook = makeHook(window, useState, useEffect)
  const render = () => {
    i = 0
    const result = hook()
    effects.splice(0).forEach(run => run())
    return result
  }
  return {
    render,
    get writes() { return writes },
    saved: () => storage.has(key) ? JSON.parse(storage.get(key)) : null,
    resize(width, height) { window.innerWidth = width; window.innerHeight = height; events.dispatchEvent(new Event('resize')); return render()[0] },
    edit(patch) { render()[1](patch); return render()[0] },
  }
}

test('narrow viewport only clamps the visible Dock, never overwrites saved geometry', () => {
  const app = setup(wide)
  assert.deepEqual(app.render()[0], wide)
  const narrow = app.resize(525, 500)
  assert.deepEqual(narrow, { x: 8, y: 8, w: 509, h: 484 })
  assert.deepEqual(app.saved(), wide)
  assert.equal(app.writes, 0)
  assert.deepEqual(app.resize(1440, 900), wide)
  const reloadInNarrowWindow = setup(app.saved(), 525, 500)
  assert.deepEqual(reloadInNarrowWindow.render()[0], narrow)
  assert.deepEqual(reloadInNarrowWindow.saved(), wide)
  assert.equal(reloadInNarrowWindow.writes, 0)
  assert.deepEqual(reloadInNarrowWindow.resize(1440, 900), wide)
})

test('a user-initiated vertical resize preserves unrelated preferences clamped by the viewport', () => {
  const app = setup(wide, 525, 500)
  assert.equal(app.edit({ h: 320 }).h, 320)
  const updated = { ...wide, h: 320 }
  assert.deepEqual(app.saved(), updated)
  assert.equal(app.writes, 1)
  app.resize(1440, 900)
  assert.deepEqual(app.render()[0], updated)
  assert.deepEqual(setup(app.saved()).render()[0], updated)
})

test('defaults and restricted storage still allow the visible Dock to resize', () => {
  const fresh = setup()
  assert.equal(fresh.render()[0].w, 620)
  assert.equal(fresh.saved(), null)
  assert.equal(fresh.resize(500, 500).w, 484)
  assert.equal(fresh.saved(), null)
  const blocked = setup(null, 1440, 900, { blocked: true })
  assert.equal(blocked.render()[0].w, 620)
  assert.equal(blocked.edit({ w: 720 }).w, 720)
  assert.equal(blocked.resize(500, 500).w, 484)
  assert.equal(blocked.resize(1440, 900).w, 720)
})

test('legacy Dock viewport sizing and user gestures use their distinct hooks', () => {
  const dock = source.slice(source.indexOf('function PurgeDock() {'))
  assert.match(dock, /const \[geom, editGeom\] = useDockGeometry\(\)/)
  assert.match(dock, /width: geom\.w \+ "px"/)
  assert.match(dock, /startResizeRight[\s\S]*?editGeom\(\{ w: ow \+ \(ev\.clientX - sx\) \}\)/)
  assert.match(dock, /startResizeBottom[\s\S]*?editGeom\(\{ h: oh \+ \(ev\.clientY - sy\) \}\)/)
})

test('a viewport smaller than the normal Dock minimum still contains the Dock', () => {
  const app = setup(wide)
  assert.deepEqual(app.render()[0], wide)
  assert.deepEqual(app.resize(320, 200), { x: 8, y: 8, w: 304, h: 184 })
  assert.deepEqual(app.saved(), wide)
  assert.equal(app.writes, 0)
  assert.deepEqual(app.resize(1440, 900), wide)
  assert.deepEqual(setup(wide, 320, 200).render()[0], { x: 8, y: 8, w: 304, h: 184 })
  assert.match(source, /min-width:min\(380px,calc\(100vw - 16px\)\);min-height:min\(240px,calc\(100vh - 16px\)\)/)
})
