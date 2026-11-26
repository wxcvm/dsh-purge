const shaPattern = /^[a-f0-9]{40}$/i
const failed = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'])
const label = (value, length = 160) => typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').slice(0, length) : ''
const sha = value => typeof value === 'string' && shaPattern.test(value) ? value.toLowerCase() : null

function reference(value, kind) {
  const format = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/(pull|issues)\/([1-9]\d{0,14})\/?$/
  const match = typeof value === 'string' && format.exec(value.trim())
  if (!match || match[3] !== kind || match[2] === '.' || match[2] === '..') {
    throw Error(kind === 'pull' ? '请输入公开 GitHub PR 链接' : '请输入公开 GitHub Issue 链接')
  }
  const [, owner, repo, , number] = match
  const name = owner + '/' + repo
  return { name, number: Number(number), canonical: 'https://github.com/' + name + '/' + kind + '/' + number }
}

async function publicRequest(path) {
  const res = await fetch('https://api.github.com/repos/' + path, {
    signal: AbortSignal.timeout(7000), redirect: 'error',
    headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'Purge-SuperAgent-Document-Preview' },
  })
  if (res.status === 429 || (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')))) {
    throw Error('GitHub 公开 API 暂时限流；未覆盖已保存证据，请稍后重试')
  }
  if (!res.ok) throw Error('GitHub 公开证据未取得（HTTP ' + res.status + '）')
  // A bounded response avoids keeping raw check output or Issue bodies.
  const reader = res.body.getReader()
  let size = 0
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2000000) throw Error('GitHub 响应过大，未保存证据')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value && /rel="next"/.test(res.headers.get('link') || '')) value.has_more = true
  return value
}

export async function readGitHubEvidence({ pr_url, issue_url, expected_sha }, request = publicRequest) {
  const pr = reference(pr_url, 'pull')
  const issue = issue_url ? reference(issue_url, 'issues') : null
  const expected = typeof expected_sha === 'string' ? expected_sha.trim() : ''
  if (expected && !sha(expected)) throw Error('提交号须为完整 40 位 SHA')
  const readHead = async () => {
    const data = await request(pr.name + '/pulls/' + pr.number)
    if (data.number !== pr.number || !sha(data.head?.sha)) throw Error('无法核实当前 PR 提交')
    return data
  }
  const original = await readHead()
  const head = sha(original.head.sha)
  if (expected && sha(expected) !== head) throw Error('PR 当前提交与指定 SHA 不同；未保存证据')
  const [raw, linked] = await Promise.all([
    request(pr.name + '/commits/' + head + '/check-runs?filter=latest&per_page=100'),
    issue ? request(issue.name + '/issues/' + issue.number) : null,
  ])
  if (issue && (linked?.number !== issue.number || linked.pull_request)) throw Error('附带链接不是有效 Issue')
  if (!Array.isArray(raw.check_runs) || !Number.isSafeInteger(raw.total_count) || raw.total_count < 0) {
    throw Error('无法核实 GitHub 检查列表')
  }
  const checks = raw.check_runs
    .filter(run => sha(run?.head_sha) === head)
    .map(run => ({ name: label(run.name), status: label(run.status, 32), conclusion: label(run.conclusion, 32) || null }))
  const complete = checks.length === raw.total_count && checks.length === raw.check_runs.length && raw.has_more !== true
  const state = checks.some(row => row.status === 'completed' && failed.has(row.conclusion)) ? 'failure'
    : !complete ? 'unconfirmed'
      : !checks.length ? 'empty'
        : checks.some(row => row.status !== 'completed') ? 'pending'
          : checks.every(row => row.conclusion === 'success') ? 'observed-success' : 'unconfirmed'
  const current = await readHead()
  if (head !== sha(current.head.sha)) throw Error('读取期间 PR 更新了提交；请重新读取')
  return {
    source: 'github-public-check-runs', checked_at: new Date().toISOString(),
    pr: { url: pr.canonical, number: pr.number, title: label(current.title),
      state: current.merged === true ? 'merged' : current.state === 'closed' ? 'closed' : 'open' },
    issue: issue ? { url: issue.canonical, number: issue.number, title: label(linked.title), state: linked.state === 'closed' ? 'closed' : 'open' } : null,
    sha: head, commit_url: 'https://github.com/' + pr.name + '/commit/' + head,
    total_count: raw.total_count, verified_count: checks.length, complete, state, checks,
  }
}

// The evidence is a property of one existing attempt, not a second task ledger.
export const GITHUB_EVIDENCE_DDL = 'CREATE TABLE IF NOT EXISTS preview_github_evidence (' +
  'assignment_id INTEGER PRIMARY KEY REFERENCES agent_work_assignment(id) ON DELETE CASCADE, snapshot TEXT NOT NULL)'

export function evidenceForTask(db, taskId) {
  const rows = db.prepare('SELECT e.assignment_id, e.snapshot FROM preview_github_evidence e ' +
    'JOIN agent_work_assignment a ON a.id = e.assignment_id WHERE a.task_id = ?').all(taskId)
  return new Map(rows.map(row => [row.assignment_id, JSON.parse(row.snapshot)]))
}

export function saveGitHubEvidence(db, { taskId, revision, assignmentId, evidence }) {
  // Validate and save in one SQL statement after the network read. No stale
  // request can put the old PR evidence on a new or already reviewed attempt.
  const saved = db.prepare('INSERT INTO preview_github_evidence (assignment_id, snapshot) ' +
    'SELECT a.id, ? FROM agent_work_assignment a JOIN agent_work_item t ON t.id = a.task_id ' +
    "WHERE t.id = ? AND t.revision = ? AND t.status = 'ready' AND a.attempt = t.attempt AND a.id = ? " +
    'ON CONFLICT(assignment_id) DO UPDATE SET snapshot = excluded.snapshot')
    .run(JSON.stringify(evidence), taskId, revision, assignmentId)
  return saved.changes === 1
}