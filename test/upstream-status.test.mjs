import test from 'node:test'
import assert from 'node:assert/strict'
import { checkUpstreams, compareVersions, githubUpstreamRequest } from '../lib/upstream-status.js'

const sha = 'a'.repeat(40)
const request = async url => url.includes('/commits/') ? { sha }
  : url.includes('/releases?') ? [{ tag_name: 'irrelevant', draft: false }, { tag_name: 'dsh-v0.2.2-rc.2', draft: false }, { tag_name: 'dsh-v0.2.2-rc.3', draft: false, prerelease: true }]
    : { default_branch: 'master' }

test('prerelease comparisons distinguish rc.2, rc.3 and stable, invalid versions stay unknown', () => {
  assert.equal(compareVersions('0.2.2-rc.2', '0.2.2-rc.3'), -1)
  assert.equal(compareVersions('0.2.2-rc.3', '0.2.2'), -1)
  assert.equal(compareVersions('0.2.2-rc.3', '0.2.2-rc.3'), 0)
  assert.equal(compareVersions('0.2.2-rc.10', '0.2.2-rc.3'), 1)
  assert.equal(compareVersions('', '0.2.2-rc.3'), null)
})

test('upstream observations preserve local incorporation, official prereleases and read-only separation', async () => {
  const r = await checkUpstreams({ request, localHostVersion: '0.2.2-rc.3', containsCommit: () => true })
  assert.equal(r.ok, true)
  assert.equal(r.sources[0].headIncludedInLocalHistory, true)
  assert.equal(r.sources[2].releaseUpdateAvailable, false)
  assert.equal(r.sources[2].latestRelease.prerelease, true)
  assert.equal(r.autoInstall, false)
  assert.equal(r.sourceSwitch, false)
})

test('errors and missing baselines never become false up-to-date results or leak error bodies', async () => {
  const r = await checkUpstreams({ request: async url => {
    if (url.includes('YuJunZhiXue')) { const e = new Error('PRIVATE_TOKEN'); e.status = 404; throw e }
    return request(url)
  } })
  assert.equal(r.ok, true, 'historical reference failure is reported but primary sources are independent')
  assert.equal(r.sources[1].status, 'unavailable')
  assert.equal(r.sources[1].updateAvailable, null)
  assert.equal(r.sources[0].unincorporatedHead, null)
  assert.equal(r.sources[2].releaseUpdateAvailable, null)
  assert.ok(!JSON.stringify(r).includes('PRIVATE_TOKEN'))
  const failed = await checkUpstreams({ request: async () => { throw new Error('network') } })
  assert.equal(failed.ok, false)
})

test('upstream transport rejects non-GitHub targets before making requests', async () => {
  await assert.rejects(githubUpstreamRequest()('https://example.invalid/'), /unexpected upstream/)
})

test('public Git observations avoid API quotas and distinguish tags from published releases', async () => {
  const r = await checkUpstreams({ localHostVersion: '0.2.2-rc.3', containsCommit: () => true,
    observePublic: async () => ({ head: sha, branch: 'master', tags: ['dsh-v0.2.2-rc.2', 'dsh-v0.2.2-rc.3'] }),
    request: async () => { const e = new Error('rate limited'); e.status = 403; throw e },
  })
  assert.equal(r.ok, true)
  assert.equal(r.sources[2].transport, 'public-git-refs')
  assert.equal(r.sources[2].latestTag.version, '0.2.2-rc.3')
  assert.equal(r.sources[2].latestRelease, undefined)
  assert.equal(r.sources[2].tagUpdateAvailable, false)
  assert.equal(r.sources[1].status, 'unavailable')
})
