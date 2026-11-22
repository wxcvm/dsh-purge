import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { AGENT_WORK_DDL, migrateAgentWork } from '../../lib/redteam/agent-work-schema.js'
import { createWorkItem, assignWorkItem, observeWorkItemEnd, reportWorkItem,
  getWorkItem, listWorkItems, requestWorkItemChanges, closeWorkItem } from '../../lib/redteam/agent-work-items.js'

const assets = new Map(Object.entries({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
}).map(([path, [file, type]]) => [path, { type, body: readFileSync(new URL(file, import.meta.url)) }]))
export const preview = 'purge-superagent-document-preview'
const manifest = (() => {
  try { return JSON.parse(readFileSync(new URL('build.json', import.meta.url), 'utf8')) }
  catch { return { commit: null } }
})()

function runCheck(check, text) {
  return new Promise((done, fail) => {
    const worker = new Worker(new URL('review-worker.mjs', import.meta.url), { workerData: { check, text } })
    let result, error
    worker.on('message', value => { result = value })
    worker.once('error', value => { error = value })
    worker.once('exit', code => {
      if (error) fail(error)
      else if (code !== 0 || typeof result?.found !== 'boolean' || !Number.isFinite(result.ms) || !Number.isSafeInteger(result.threadId)) fail(Error('文档检查未返回有效结果'))
      else done(result)
    })
  })
}
async function input(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw Error('只接受 JSON')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > 196608) throw Error('请求过大')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('请输入对象')
  return value
}

const checks = Object.freeze([
  { id: 'heading', label: '一级标题' },
  { id: 'appendix', label: '附录标题' },
])

export function createPreview({ dataDir, checkDocument = runCheck }) {
  mkdirSync(dataDir, { recursive: true })
  for (const name of ['tasks.sqlite', 'tasks.sqlite-journal', 'tasks.sqlite-wal', 'tasks.sqlite-shm']) {
    const existing = lstatSync(join(dataDir, name), { throwIfNoEntry: false })
    if (existing && !existing.isFile()) throw Error('预览数据路径不是普通文件')
  }
  const db = new DatabaseSync(join(dataDir, 'tasks.sqlite'))
  db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;')
  db.exec(AGENT_WORK_DDL)
  migrateAgentWork(db)
  let active = null

  async function finish(job, text) {
    // The executor is deliberately limited to these two checks. A document
    // never supplies step names, tools or an executable plan.
    const results = await Promise.allSettled(checks.map(async ({ id, label }, i) => {
      job.steps[i].status = 'running'
      try {
        const result = await checkDocument(id, text)
        job.steps[i].status = 'done'
        return { label, ...result }
      } catch (error) {
        job.steps[i].status = 'failed'
        throw error
      }
    }))
    const ready = results.every(result => result.status === 'fulfilled')
    job.steps[2].status = ready ? 'done' : 'blocked'
    const resultText = ready
      ? results.map(({ value }) => value.label + '：' + (value.found ? '有' : '缺少')).join('；') + '。'
        + '\n两项检查均退出后汇总。'
        + results.map(({ value }) => value.label + ' worker #' + value.threadId + '：' + value.ms.toFixed(2) + ' ms').join('；')
      : '至少一项文档检查失败，未生成验收报告。可重新提交正文。'
    observeWorkItemEnd(db, { ...job.identity, stop_reason: ready ? 'completed' : 'error' })
    reportWorkItem(db, { ...job.identity, status: ready ? 'ready' : 'failed', summary: resultText })
  }

  function run(body) {
    if (active) throw Error('已有一次文档检查正在进行')
    if (typeof body.document !== 'string' || !body.document.trim() || body.document.length > 40000) {
      throw Error('请粘贴 1 到 40000 字符的 Markdown')
    }
    const item = body.task_id == null
      ? createWorkItem(db, { task_key: randomUUID(), objective: body.title, role: 'document-review' }).item
      : getWorkItem(db, body.task_id)
    if (!item) throw Error('找不到该任务')
    const identity = { task_id: item.id, session_id: 'preview-' + item.id, run_id: randomUUID() }
    const assigned = assignWorkItem(db, identity)
    if (!assigned.assigned) throw Error('没有登记本次执行')
    const job = { identity, steps: [...checks.map(check => ({ ...check, status: 'queued' })),
      { id: 'summary', label: '汇总', status: 'waiting' }] }
    active = job
    job.finished = finish(job, body.document).catch(() => {
      // On a database write failure there is no proof that settlement
      // committed. Preserve the running record and do not auto-retry.
      console.error('预览工作台未能持久化本次结算。请核对任务记录。')
    }).finally(() => { active = null })
    return { started: true, item: assigned.item }
  }

  const app = createServer(async (req, res) => {
    const host = '127.0.0.1:' + app.address().port
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    const json = (code, data) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data))
    if (req.headers.host !== host) return json(403, { error: '只接受本机预览地址' })
    try {
      const url = new URL(req.url, 'http://' + host)
      if (req.method === 'GET') {
        const asset = assets.get(url.pathname)
        if (asset) return res.writeHead(200, { 'Content-Type': asset.type }).end(asset.body)
        if (url.pathname === '/health') return json(200, { preview, commit: manifest.commit, harness: false })
        if (url.pathname === '/tasks') return json(200, listWorkItems(db, { limit: 30 }))
        if (url.pathname === '/task') {
          const item = getWorkItem(db, url.searchParams.get('id'))
          if (!item) return json(404, { error: '找不到该任务' })
          const matches = item.status === 'running' && active?.identity.task_id === item.id
            && active.identity.run_id === item.assignment?.run_id
          return json(200, matches ? { ...item, preview_steps: active.steps } : item)
        }
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== 'http://' + host) return json(403, { error: '请在本机工作台提交' })
        const body = await input(req)
        if (url.pathname === '/run') return json(202, run(body))
        if (url.pathname === '/review') {
          if (!Number.isSafeInteger(body.expected_revision)) throw Error('请重新读取任务版本')
          const result = body.decision === 'changes'
            ? requestWorkItemChanges(db, body)
            : body.decision === 'accept' ? closeWorkItem(db, { ...body, outcome: 'done' }) : null
          if (!result) throw Error('未知验收操作')
          return json(result.returned || result.closed ? 200 : 409, result)
        }
      }
      return json(404, { error: '未知路径' })
    } catch (error) {
      json(400, { error: error?.message || '操作失败' })
    }
  })
  app.once('close', () => {
    if (active) void active.finished.then(() => db.close())
    else db.close()
  })
  return app
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('用法：node server.mjs <数据目录> [端口]')
  const app = createPreview({ dataDir: resolve(process.argv[2]) })
  app.listen(Number(process.argv[3] ?? 17836), '127.0.0.1',
    () => console.log('Super Agent 桌面预览：http://127.0.0.1:' + app.address().port))
}