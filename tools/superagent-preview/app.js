'use strict'
const el = id => document.getElementById(id)
const labels = { queued: '待运行', running: '运行中／上次运行待核对', waiting: '待补充', ready: '待验收',
  blocked: '待处理', failed: '检查失败', interrupted: '已中断', done: '已验收', dropped: '已放弃' }
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
function show(item) {
  selected = item
  el('detail').hidden = !item
  el('input').hidden = Boolean(item && !['waiting', 'failed', 'interrupted'].includes(item.status))
  el('review').hidden = item?.status !== 'ready'
  el('editorTitle').textContent = item ? '提交补充正文' : '提交文档'
  el('title').disabled = Boolean(item)
  el('title').value = item?.objective || ''
  el('text').value = ''
  el('feedback').value = ''
  if (!item) return
  el('taskTitle').textContent = item.objective
  el('taskStatus').textContent = labels[item.status] || item.status
  el('history').replaceChildren()
  for (const run of item.history || []) {
    const li = add(el('history'), 'li', '第 ' + run.attempt + ' 次 · ' + (labels[run.status] || run.status))
    if (run.summary) add(li, 'p', run.summary)
    if (run.host_end_at) add(li, 'small', '本地文档 worker 结束：' + new Date(run.host_end_at).toLocaleString())
    if (run.review_feedback) add(li, 'p', '补充要求：' + run.review_feedback)
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
    if (row.id === id) open.setAttribute('aria-current', 'true')
    open.addEventListener('click', () => runAction(() => refresh(row.id)))
  }
  if (page.items.length === 0) add(el('tasks'), 'li', '还没有文档任务')
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
    await refresh(result.item.id)
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