'use strict'
const el = id => document.getElementById(id)
const labels = { queued: '待运行', running: '运行中／上次运行待核对', waiting: '待补充', ready: '待验收',
  blocked: '待处理', failed: '检查失败', interrupted: '已中断', done: '已验收', dropped: '已放弃' }
const stepLabels = { queued: '待运行', running: '检查中', done: '已完成', failed: '失败',
  waiting: '等待两项检查', blocked: '未汇总' }
const recoveryLabels = {
  'owner-exited': '本机已找不到上次的预览进程，且未记录本次结果。可人工标记中断；若要重跑，请再提交正文。',
  'owner-unverified': '仍存在上次登记的进程号，但这不证明原运行仍在进行。只能再次核对，不会自动重跑。',
  'owner-unknown': '旧执行记录缺少可核对的进程身份，不能仅凭这一页认定中断。',
  'ended-unreported': '本次运行已有结束记录，但没有提交结果。它尚未完成验收。',
}
const checkLabels = { 'observed-success': '返回的检查全部成功（不等于所有必需检查）',
  failure: '发现未通过检查', pending: '检查尚未全部结束', unconfirmed: '缺少完整成功证据', empty: '未找到该提交的检查' }
let selected = null, pending = false
const msg = text => { el('message').textContent = text }
const api = async (path, body) => {
  const result = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await result.json()
  if (!result.ok) throw Error(data.error || data.reason || '操作未完成')
  return data
}
function add(parent, type, content) {
  const child = document.createElement(type)
  child.textContent = content
  parent.append(child)
  return child
}
function githubLink(parent, url, text) {
  if (typeof url !== 'string' || !url.startsWith('https://github.com/')) return
  const link = add(parent, 'a', text)
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
}
function showEvidence(parent, evidence) {
  const box = document.createElement('details')
  parent.append(box)
  add(box, 'summary', 'GitHub · ' + evidence.sha.slice(0, 12) + ' · ' + (checkLabels[evidence.state] || '待核对'))
  const links = add(box, 'p', '')
  githubLink(links, evidence.pr.url, 'PR #' + evidence.pr.number)
  if (evidence.issue) {
    links.append(' · ')
    githubLink(links, evidence.issue.url, 'Issue #' + evidence.issue.number)
  }
  links.append(' · ')
  githubLink(links, evidence.commit_url, '精确提交')
  add(box, 'p', '核对时间：' + new Date(evidence.checked_at).toLocaleString()
    + '；已匹配 ' + evidence.verified_count + ' / ' + evidence.total_count + ' 条检查。')
  if (evidence.checks.length) {
    const checks = add(box, 'ul', '')
    for (const check of evidence.checks) add(checks, 'li', check.name + ' · ' + (check.conclusion || check.status))
  }
}
function show(item) {
  selected = item
  el('detail').hidden = !item
  el('input').hidden = Boolean(item && !['waiting', 'failed', 'interrupted'].includes(item.status))
  el('review').hidden = item?.status !== 'ready'
  el('github').hidden = item?.status !== 'ready'
  const latestEvidence = item?.history?.[0]?.github_evidence
  el('githubPR').value = latestEvidence?.pr.url || ''
  el('githubIssue').value = latestEvidence?.issue?.url || ''
  el('githubSHA').value = latestEvidence?.sha || ''
  el('editorTitle').textContent = item ? '提交补充正文' : '提交文档'
  el('title').disabled = Boolean(item)
  el('title').value = item?.objective || ''
  el('text').value = ''
  el('feedback').value = ''
  el('interruption').hidden = !item?.recovery?.can_mark
  el('interruptionReason').value = ''
  const recoveryText = recoveryLabels[item?.recovery?.state] || ''
  el('recoveryNote').hidden = !recoveryText
  el('recoveryNote').textContent = recoveryText
  if (!item) return
  el('taskTitle').textContent = item.objective
  el('taskStatus').textContent = item.preview_steps ? '正在检查'
    : item.recovery?.can_mark ? '待处理：上次未交付' : labels[item.status] || item.status
  el('steps').hidden = !item.preview_steps
  el('steps').replaceChildren()
  for (const step of item.preview_steps || []) add(el('steps'), 'li', step.label + ' · ' + stepLabels[step.status])
  el('history').replaceChildren()
  for (const run of item.history || []) {
    const li = add(el('history'), 'li', '第 ' + run.attempt + ' 次 · ' + (labels[run.status] || run.status))
    if (run.summary) add(li, 'p', run.summary).className = 'summary'
    if (run.host_end_at) add(li, 'small', '本地文档 worker 结束：' + new Date(run.host_end_at).toLocaleString())
    if (run.review_feedback) add(li, 'p', '补充要求：' + run.review_feedback)
    if (run.github_evidence) showEvidence(li, run.github_evidence)
  }
  if (item.status === 'done') add(el('history'), 'li', '验收结论：' + item.last_outcome)
}
async function refresh(id) {
  const page = await api('/tasks')
  const item = id ? await api('/task?id=' + id) : null
  show(item)
  el('tasks').replaceChildren()
  for (const row of page.items) {
    const li = add(el('tasks'), 'li', '')
    const open = add(li, 'button', row.objective + ' · ' + (labels[row.status] || row.status))
    open.type = 'button'
    open.disabled = pending
    if (row.id === id) open.setAttribute('aria-current', 'true')
    open.addEventListener('click', () => runAction(() => follow(row.id)))
  }
  if (page.items.length === 0) add(el('tasks'), 'li', '还没有文档任务')
}
async function follow(id) {
  await refresh(id)
  if (!selected?.preview_steps) return
  for (let i = 0; i < 60 && selected?.preview_steps; i++) {
    await new Promise(resolve => setTimeout(resolve, 250))
    show(await api('/task?id=' + id))
  }
  if (!selected?.preview_steps) await refresh(id)
  else throw Error('检查仍在进行。稍后重新打开本任务可查看最新结果。')
}
async function runAction(action) {
  if (pending) return
  pending = true
  for (const button of document.querySelectorAll('button')) button.disabled = true
  msg('处理中…')
  try { await action(); msg('') }
  catch (error) { msg(error.message || '操作失败') }
  finally {
    pending = false
    for (const button of document.querySelectorAll('button')) button.disabled = false
  }
}
el('new').addEventListener('click', () => runAction(() => refresh(null)))
el('sample').addEventListener('click', () => {
  if (!selected) el('title').value = '部署说明示例'
  el('text').value = '# 部署说明\n\n示例正文。\n' + (selected ? '\n## 附录\n\n补充说明。\n' : '')
  el('text').focus()
})
el('run').addEventListener('submit', event => {
  event.preventDefault()
  runAction(async () => {
    const result = await api('/run', { task_id: selected?.id, title: el('title').value, document: el('text').value })
    await follow(result.item.id)
  })
})
el('interruption').addEventListener('submit', event => {
  event.preventDefault()
  if (!selected?.recovery?.can_mark) return
  runAction(async () => {
    const id = selected.id
    await api('/interrupt', { task_id: id, run_id: selected.assignment.run_id,
      expected_revision: selected.revision, reason: el('interruptionReason').value })
    await refresh(id)
  })
})
el('github').addEventListener('submit', event => {
  event.preventDefault()
  if (selected?.status !== 'ready') return
  runAction(async () => {
    const { id, revision } = selected
    const draft = el('feedback').value
    await api('/github-evidence', { task_id: id, expected_revision: revision,
      pr_url: el('githubPR').value, issue_url: el('githubIssue').value, expected_sha: el('githubSHA').value })
    await refresh(id)
    if (selected?.id === id && selected.revision === revision) el('feedback').value = draft
  })
})
el('review').addEventListener('submit', event => {
  event.preventDefault()
  const decision = event.submitter?.value
  if (!decision || !selected) return
  runAction(async () => {
    const id = selected.id
    await api('/review', { task_id: id, expected_revision: selected.revision, decision, reason: el('feedback').value })
    await refresh(id)
  })
})
api('/health').then(info => { el('build').textContent = '构建：' + (info.commit?.slice(0, 12) || '源码运行') }).catch(() => {})
runAction(() => refresh(null))