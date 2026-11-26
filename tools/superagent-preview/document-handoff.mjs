import { createHash } from 'node:crypto'

const digest = text => createHash('sha256').update(text, 'utf8').digest('hex')
const normalized = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
// Render operator text as plain text rather than active Markdown/HTML.
const literal = text => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/[\\\x60*_[\]{}<>!#|~]/g, '\\$&')
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
function githubLink(value, kind) {
  const match = typeof value === 'string' && /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues|commit)\/([A-Za-z0-9]+)$/.exec(value)
  if (!match || match[2] === '.' || match[2] === '..' || match[3] !== kind) return null
  if (kind === 'commit' ? !sha(match[4]) : !/^[1-9][0-9]*$/.test(match[4])) return null
  return value
}

export function makeDocumentHandoff(item, evidence) {
  const run = item?.assignment
  const report = /^一级标题：(有|缺少)；附录标题：(有|缺少)。/.exec(run?.summary || '')
  if (!report || !uuid(item?.task_key) || !uuid(run?.run_id) || item?.status !== 'done' || run?.status !== 'ready' || !run.finished_at ||
      run.task_id !== item.id || run.attempt !== item.attempt) return null

  const lines = [
    '# Super Agent 已验收文档交付', '',
    '- 来源：Purge Super Agent 本地文档工作台',
    '- 任务键：' + literal(item.task_key),
    '- 运行：' + literal(run.run_id) + '（第 ' + run.attempt + ' 次）',
    '- 验收时间（UTC）：' + literal(item.updated_at),
    '', '## 结果', '',
    '- 一级标题：' + report[1],
    '- 附录标题：' + report[2],
    '- 验收状态：已人工确认。内部说明不随文件导出。',
  ]
  if (evidence?.source === 'github-public-check-runs' && sha(evidence.sha) &&
      Number.isSafeInteger(evidence.verified_count) && evidence.verified_count >= 0) {
    lines.push('', '## GitHub 证据快照', '', '- SHA：' + sha(evidence.sha),
      '- 核对时间（UTC）：' + literal(evidence.checked_at),
      '- 匹配到的检查数：' + Number(evidence.verified_count),
      '- 观察状态：' + literal(evidence.state) + '（不是分支保护证明）')
    for (const [kind, value, name] of [['issues', evidence.issue?.url, '公开 Issue'],
      ['pull', evidence.pr?.url, '公开 PR'], ['commit', evidence.commit_url, '精确提交']]) {
      const link = githubLink(value, kind)
      if (link) lines.push('- [' + name + '](' + link + ')')
    }
  }
  lines.push('', '仅供人工交接。不包含 Markdown 原文、工作站路径、凭据、人工填写的任务标题、反馈或内部会话标识。', '')
  const markdown = lines.join('\n')
  const sha256 = digest(markdown)
  return { markdown, sha256, filename: 'purge-document-handoff-' + sha256.slice(0, 16) + '.md' }
}

export function verifyDocumentHandoff(receipt, text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 50000) throw Error('请粘贴回读的 Markdown 正文')
  const received = digest(normalized(text))
  return { matches: received === receipt.sha256, expected: receipt.sha256, received, writes: false }
}