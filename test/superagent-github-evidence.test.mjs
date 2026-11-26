import test from 'node:test'
import assert from 'node:assert/strict'
import { readGitHubEvidence } from '../tools/superagent-preview/github-evidence.mjs'

const old = '1'.repeat(40)
const head = 'a'.repeat(40)
const input = { pr_url: 'https://github.com/owner/repo/pull/7', issue_url: 'https://github.com/owner/repo/issues/8', expected_sha: head }
const check = (overrides = {}) => ({ name: 'unit', head_sha: head, status: 'completed', conclusion: 'success', ...overrides })

function github({ checks = [check()], total = checks.length, recheck = head, issue = {}, calls = [], hasMore = false } = {}) {
  let reads = 0
  return path => {
    calls.push(path)
    if (path === 'owner/repo/pulls/7') return { number: 7, state: 'closed', merged: true, title: 'PR', head: { sha: reads++ ? recheck : head } }
    if (path === 'owner/repo/issues/8') return { number: 8, title: 'Issue', state: 'open', ...issue }
    assert.equal(path, 'owner/repo/commits/' + head + '/check-runs?filter=latest&per_page=100')
    return { total_count: total, check_runs: checks, has_more: hasMore }
  }
}

test('binds public Issue, PR and Checks to the exact head and rechecks head before returning', async () => {
  const calls = []
  const result = await readGitHubEvidence(input, github({ calls }))
  assert.equal(result.sha, head)
  assert.equal(result.pr.state, 'merged')
  assert.equal(result.issue.number, 8)
  assert.equal(result.state, 'observed-success')
  assert.equal(result.verified_count, 1)
  assert.equal(calls[0], 'owner/repo/pulls/7')
  assert.equal(calls.at(-1), 'owner/repo/pulls/7')
  const observed = await readGitHubEvidence({ ...input, issue_url: '', expected_sha: '' }, github())
  assert.equal(observed.issue, null)
  assert.equal(observed.sha, head)
})

test('does not promote missing, truncated, different-head, running or non-success checks', async () => {
  for (const [options, state] of [
    [{ checks: [] }, 'empty'],
    [{ total: 101 }, 'unconfirmed'],
    [{ hasMore: true }, 'unconfirmed'],
    [{ checks: [check({ head_sha: old })] }, 'unconfirmed'],
    [{ checks: [check({ status: 'in_progress', conclusion: null })] }, 'pending'],
    [{ checks: [check({ conclusion: 'skipped' })] }, 'unconfirmed'],
    [{ checks: [check({ conclusion: 'failure' })] }, 'failure'],
  ]) assert.equal((await readGitHubEvidence(input, github(options))).state, state)
})

test('rejects unsafe URLs, wrong requested SHA, moved heads and PRs presented as Issues', async () => {
  for (const pr_url of ['https://elsewhere.test/owner/repo/pull/7',
    'https://github.com/owner/../pull/7', 'https://github.com/owner/repo/pull/7?token=x',
    'https://github.com@elsewhere.test/owner/repo/pull/7']) {
    const calls = []
    await assert.rejects(() => readGitHubEvidence({ ...input, pr_url }, github({ calls })), /公开 GitHub PR/)
    assert.equal(calls.length, 0)
  }
  await assert.rejects(() => readGitHubEvidence({ ...input, expected_sha: 'abc' }, github()), /40 位/)
  await assert.rejects(() => readGitHubEvidence({ ...input, expected_sha: old }, github()), /指定 SHA/)
  await assert.rejects(() => readGitHubEvidence(input, github({ recheck: old })), /更新了提交/)
  await assert.rejects(() => readGitHubEvidence(input, github({ issue: { pull_request: {} } })), /有效 Issue/)
})
