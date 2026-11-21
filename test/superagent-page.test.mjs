import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props, children })
const nodes = tree => !tree || typeof tree !== 'object' ? []
  : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...tree.children.flatMap(nodes)]
function load(name, end, React, AgentReports, WorkItemsPanel) {
  const start = client.indexOf('function ' + name + '(')
  const stop = client.indexOf('function ' + end + '(', start)
  assert.ok(start > 0 && stop > start)
  return new Function('h', 'React', 'AgentReports', 'WorkItemsPanel', client.slice(start, stop) + '\nreturn ' + name)(
    h, React, AgentReports, WorkItemsPanel)
}

test('Super Agent is a separate entry with project-scoped panels and jumps', () => {
  assert.match(client, /\['superagent', 'Super Agent'\]/)
  assert.match(client, /else if \(st\.tab === 'superagent'\) body = h\(SuperAgentTab/)
  assert.match(client, /onOpenSuperAgent: \(\) => openSuperAgent\(\)/)
  const AgentReports = () => {}
  const WorkItemsPanel = () => {}
  const tab = load('SuperAgentTab', 'AgentsTab', { useRef: current => ({ current }) }, AgentReports, WorkItemsPanel)
  const navigation = () => {}
  const receipt = () => {}
  let reportReady = 0, ledgerFocused = 0
  const page = nodes(tab({
    engagement: 'project-a', onOpenReportSession: navigation,
    onReportReceipt: receipt, onReportSectionReady: () => { reportReady++ }, maskReportOrigin: true,
  }))
  const inbox = page.find(n => n.type === AgentReports)
  const work = page.find(n => n.type === WorkItemsPanel)
  assert.equal(inbox.props.key, 'agent-reports:project-a')
  assert.equal(work.props.key, 'agent-work:project-a')
  assert.strictEqual(inbox.props.onReceipt, receipt)
  assert.strictEqual(work.props.onOpenSession, navigation)
  assert.equal(inbox.props.maskReportOrigin, true)
  assert.equal(work.props.maskReportOrigin, true)
  page.find(n => n.props?.['aria-label'] === '持久任务').props.ref.current = { focus() { ledgerFocused++ } }
  inbox.props.onSectionReady({ focus() { reportReady++ } })
  page.find(n => n.children[0] === '查看待阅回报').props.onClick()
  page.find(n => n.children[0] === '查看持久任务').props.onClick()
  assert.equal(reportReady, 2)
  assert.equal(ledgerFocused, 1)
})

test('history keeps registration, host-end and settlement separate and opens only the saved session', () => {
  let error = ''
  const render = load('WorkAttemptEvidence', 'SuperAgentTab', { useState: () => [error, next => { error = next }] })
  const opened = []
  const open = (...ids) => { opened.push(ids); return 'archived' }
  const attempt = {
    attempt: 2, session_id: 'exact-child', run_id: 'run-2', parent_session: 'do-not-open',
    started_at: '2026-11-21T01:00:00Z', host_end_at: '2026-11-21T01:10:00Z', finished_at: '2026-11-21T01:07:00Z',
  }
  const tree = render({ attempt, onOpenSession: open })
  assert.deepEqual(nodes(tree).filter(n => n.type === 'time').map(n => n.props.dateTime), [
    '2026-11-21T01:00:00.000Z', '2026-11-21T01:10:00.000Z', '2026-11-21T01:07:00.000Z',
  ])
  nodes(tree).find(n => n.type === 'button').props.onClick()
  assert.deepEqual(opened, [['exact-child']])
  assert.equal(nodes(render({ attempt, onOpenSession: open })).find(n => n.props?.role === 'alert').children[0],
    '来源会话或其所属会话已归档。')
  const unknown = render({ attempt: { ...attempt, session_id: '', host_end_at: null }, onOpenSession: open })
  assert.equal(nodes(unknown).some(n => n.type === 'button'), false)
  assert.match(JSON.stringify(unknown), /未观测到精确结束事件/)
  assert.doesNotMatch(JSON.stringify(unknown), /人工核验已完成/)
  assert.equal(nodes(render({ attempt })).some(n => n.type === 'button'), false, 'no native service, no link')
})
