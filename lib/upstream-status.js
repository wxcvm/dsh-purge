/** Read-only upstream observations, separate from installing the fork's update channel. */
import { requestTextWithProxy } from './redteam/proxy-network.js'

export const UPSTREAMS = Object.freeze([
  { id: 'original-plugin', repository: 'mmparko/dsh-purge', required: true },
  { id: 'previous-reference', repository: 'YuJunZhiXue/dsh-purge', required: false },
  { id: 'official-host', repository: 'deepseek-ai/deepseek-harness', required: true, releasePrefix: 'dsh-v' },
  { id: 'maintained-reference', repository: 'CallMeGuLab/dsh-purge-safe', required: false },
])

export function compareVersions(left, right) {
  const parse = value => String(value || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z.-]+))?$/)
  const a = parse(left), b = parse(right)
  if (!a || !b) return null
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Math.sign(Number(a[i]) - Number(b[i]))
  if (!a[4] || !b[4]) return a[4] === b[4] ? 0 : a[4] ? -1 : 1
  const x = a[4].split('.'), y = b[4].split('.')
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i])
    if (nx && ny) return Math.sign(Number(x[i]) - Number(y[i]))
    if (nx !== ny) return nx ? -1 : 1
    return x[i] < y[i] ? -1 : 1
  }
  return 0
}

export function githubUpstreamRequest(proxy = null) {
  return async url => {
    const target = new URL(url)
    if (target.origin !== 'https://api.github.com' || target.username || target.password) throw new Error('unexpected upstream endpoint')
    const result = await requestTextWithProxy(target, { timeout: 12000,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-purge-upstream-check' } }, proxy)
    if (result.statusCode !== 200) { const error = new Error('upstream request failed'); error.status = result.statusCode; throw error }
    return JSON.parse(result.body)
  }
}

export async function checkUpstreams({ request = githubUpstreamRequest(), localHostVersion = '', containsCommit = () => null, observePublic } = {}) {
  const sources = await Promise.all(UPSTREAMS.map(async source => {
    try {
      if (source.required && observePublic) {
        try {
          const observed = await observePublic(source)
          const row = { ...source, status: 'observed', transport: 'public-git-refs', branch: observed.branch,
            head: observed.head, url: 'https://github.com/' + source.repository, observedAt: new Date().toISOString() }
          if (source.releasePrefix) {
            const tag = observed.tags.filter(t => t.startsWith(source.releasePrefix) && compareVersions(t.slice(source.releasePrefix.length), t.slice(source.releasePrefix.length)) !== null)
              .sort((a, b) => compareVersions(b.slice(source.releasePrefix.length), a.slice(source.releasePrefix.length)))[0]
            row.latestTag = tag ? { tag, version: tag.slice(source.releasePrefix.length) } : null
            const comparison = compareVersions(localHostVersion, row.latestTag?.version)
            row.tagUpdateAvailable = comparison === null ? null : comparison < 0
            row.localHostVersion = localHostVersion || null
            row.note = 'Public tags observed without API rate limits; GitHub Release publication/assets not verified.'
          } else {
            const included = await containsCommit(observed.head)
            row.headIncludedInLocalHistory = typeof included === 'boolean' ? included : null
            row.unincorporatedHead = typeof included === 'boolean' ? !included : null
          }
          return row
        } catch { /* API remains a fallback; neither transport failure means up-to-date. */ }
      }
      const base = 'https://api.github.com/repos/' + source.repository
      const metadata = await request(base)
      if (typeof metadata.default_branch !== 'string' || !metadata.default_branch) throw new Error('invalid repository metadata')
      const head = await request(base + '/commits/' + encodeURIComponent(metadata.default_branch))
      if (!/^[a-f\d]{40}$/i.test(head.sha || '')) throw new Error('invalid upstream commit')
      const row = { ...source, status: 'observed', branch: metadata.default_branch, head: head.sha,
        url: 'https://github.com/' + source.repository, observedAt: new Date().toISOString() }
      if (source.releasePrefix) {
        const releases = await request(base + '/releases?per_page=20')
        if (!Array.isArray(releases)) throw new Error('invalid releases')
        const latest = releases.filter(r => !r.draft && typeof r.tag_name === 'string' && r.tag_name.startsWith(source.releasePrefix)
          && compareVersions(r.tag_name.slice(source.releasePrefix.length), r.tag_name.slice(source.releasePrefix.length)) !== null)
          .sort((a, b) => compareVersions(b.tag_name.slice(source.releasePrefix.length), a.tag_name.slice(source.releasePrefix.length)))[0]
        row.latestRelease = latest ? { tag: latest.tag_name, version: latest.tag_name.slice(source.releasePrefix.length), prerelease: !!latest.prerelease } : null
        const comparison = compareVersions(localHostVersion, row.latestRelease?.version)
        row.releaseUpdateAvailable = comparison === null ? null : comparison < 0
        row.localHostVersion = localHostVersion || null
        row.note = 'Release comparison includes prereleases; branch head is a separate observation, not a claim that unreleased code is installed.'
      } else {
        const included = await containsCommit(head.sha)
        row.headIncludedInLocalHistory = typeof included === 'boolean' ? included : null
        row.unincorporatedHead = typeof included === 'boolean' ? !included : null
      }
      return row
    } catch (error) {
      return { ...source, status: 'unavailable', httpStatus: Number(error?.status) || null,
        code: /^[A-Z_\d]{1,40}$/.test(error?.code || '') ? error.code : 'UPSTREAM_UNAVAILABLE',
        updateAvailable: null, note: 'Unavailable is unknown, never up-to-date. No installation or source switch performed.' }
    }
  }))
  return { schemaVersion: 1, mode: 'read-only', ok: sources.filter(s => s.required).every(s => s.status === 'observed'),
    sources, autoInstall: false, sourceSwitch: false }
}
