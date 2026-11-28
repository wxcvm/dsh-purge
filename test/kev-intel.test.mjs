import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KEV_FEED, kevStatus, lookupKev, refreshKev } from '../lib/redteam/kev-intel.js'

const now = Date.parse('2026-11-22T12:00:00.000Z')
const sample = {
  vulnerabilities: [
    { cveID: 'CVE-2021-44228', vendorProject: 'Apache', product: 'Log4j',
      vulnerabilityName: 'Log4Shell', dateAdded: '2021-12-10', knownRansomwareCampaignUse: 'Known' },
    { cveID: 'CVE-2024-12345', vendorProject: 'Example', product: 'Demo',
      vulnerabilityName: 'Synthetic fixture', dateAdded: '2024-01-02',
      knownRansomwareCampaignUse: 'Unknown' },
    { cveID: 'CVE-2021-44228', vendorProject: 'Duplicate' },
  ],
}
const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-kev-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})

test('no local feed is unavailable, not a negative CISA match', t => {
  const root = fixture(t)
  assert.deepEqual(kevStatus(root).available, false)
  assert.equal(kevStatus(root).reason, 'not_downloaded')
  const hit = lookupKev(root, 'CVE-2021-44228')
  assert.equal(hit.ok, true)
  assert.equal(hit.known_exploited, null)
  assert.equal(hit.available, false)
  assert.equal(lookupKev(root, 'not-a-cve').ok, false)
})

test('refresh is explicit, pinned to CISA, deduplicates, and keeps the cache offline', async t => {
  const root = fixture(t)
  const calls = []
  const refresh = await refreshKev(root, { now, fetchFn: async (url, opts) => {
    calls.push({ url, method: opts.method, redirect: opts.redirect, signal: !!opts.signal })
    return response(sample)
  } })
  assert.deepEqual(calls, [{ url: KEV_FEED, method: 'GET', redirect: 'error', signal: true }])
  assert.equal(refresh.ok, true)
  assert.equal(refresh.count, 2)
  assert.equal(refresh.action, 'refreshed')
  assert.equal(lookupKev(root, ' cve-2021-44228 ', now).known_exploited, true)
  assert.equal(lookupKev(root, 'CVE-2021-44228', now).item.ransomware, true)
  assert.equal(lookupKev(root, 'CVE-2024-12345', now).item.ransomware, false)
  const absent = lookupKev(root, 'CVE-2024-99999', now)
  assert.equal(absent.available, true)
  assert.equal(absent.known_exploited, false)
  assert.equal(absent.item, null)
  assert.equal(kevStatus(root, now + 25 * 3600000).stale, true)
  assert.equal(kevStatus(root, now + 12 * 3600000).stale, false)
  const persisted = JSON.parse(readFileSync(join(root, 'kb', 'cisa-kev.json'), 'utf8'))
  assert.equal(persisted.items.length, 2)
  assert.equal(Object.hasOwn(persisted, 'vulnerabilities'), false)
})

test('oversized streamed feeds are stopped before full buffering and preserve the prior cache', async t => {
  const root = fixture(t)
  await refreshKev(root, { now, fetchFn: async () => response(sample) })
  const path = join(root, 'kb', 'cisa-kev.json')
  const before = readFileSync(path, 'utf8')
  const oversized = await refreshKev(root, { now: now + 4000, fetchFn: async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(12 * 1024 * 1024 + 1))
        controller.close()
      },
    }),
  ) })
  assert.equal(oversized.ok, false)
  assert.match(oversized.reason, /feed_too_large/)
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('HTTP failures and invalid feed leave the previously good cache untouched', async t => {
  const root = fixture(t)
  await refreshKev(root, { now, fetchFn: async () => response(sample) })
  const path = join(root, 'kb', 'cisa-kev.json')
  const before = readFileSync(path, 'utf8')
  const error = await refreshKev(root, { now: now + 2000,
    fetchFn: async () => response({ message: 'error' }, 503) })
  assert.equal(error.ok, false)
  assert.equal(error.previous.available, true)
  assert.equal(readFileSync(path, 'utf8'), before)
  const invalid = await refreshKev(root, { now: now + 3000,
    fetchFn: async () => response({ vulnerabilities: [] }) })
  assert.equal(invalid.ok, false)
  assert.equal(readFileSync(path, 'utf8'), before)
  assert.equal(lookupKev(root, 'CVE-2021-44228', now + 3000).known_exploited, true)
})
