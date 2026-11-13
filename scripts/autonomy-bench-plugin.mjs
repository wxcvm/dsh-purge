/** Temporary synthetic-data plugin for the explicit headless benchmark only. */
import fs from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'
import * as purgeTools from '../lib/redteam/tools.js'

export const name = 'purge-autonomy-benchmark'
export const inject = ['tools']
export async function apply(ctx, config) {
  if (!isAbsolute(config.root) || !['baseline', 'candidate'].includes(config.arm)) throw new Error('invalid benchmark config')
  const owner = JSON.parse(fs.readFileSync(join(config.root, 'bench-owner.json'), 'utf8'))
  if (!config.runId || owner.runId !== config.runId) throw new Error('benchmark root ownership mismatch')
  const maxCalls = config.scenario === 'multistage' ? 32 : 16
  const store = new RedteamStore(config.root)
  store.failureKnowledgeOptions = {
    skills: () => [{ source: 'redteam', key: 'redteam:bench-transient', title: 'ETIMEDOUT 超时合成记录重试', description: 'Synthetic diagnostic reference only' }],
    artexStatus: () => ({ available: false, state: 'missing' }),
  }
  ctx.effect(() => () => store.close())
  const engagement = store.openEngagement('synthetic benchmark', ['192.0.2.0/24'], { bindCurrent: false })
  for (let id = 1; id <= (config.scenario === 'multistage' ? 3 : 1); id++) {
    store.db(engagement.id).prepare("INSERT OR IGNORE INTO asset(id,segment_cidr,ip,state) VALUES(?,'192.0.2.0/24',?,'live')").run(id, '192.0.2.' + id)
  }
  const fixturePath = join(config.root, 'fixture.json')
  const fixture = { engagement: engagement.id, dbPath: store.dbPathOf(engagement.id) }
  if (fs.existsSync(fixturePath)) {
    if (JSON.stringify(JSON.parse(fs.readFileSync(fixturePath, 'utf8'))) !== JSON.stringify(fixture)) throw new Error('fixture identity mismatch')
  } else fs.writeFileSync(fixturePath, JSON.stringify(fixture), { flag: 'wx' })
  ctx.provide('redteam', store)
  await ctx.plugin(purgeTools)
  const allowed = ['redteam_asset_get', 'redteam_http_evidence_add', 'redteam_http_evidence_query']
  if (config.arm === 'candidate') allowed.push('redteam_task_run')
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: allowed })
    const advertised = agent.ctx.tools.schemas(agent).map(tool => tool.name)
    if (advertised.some(name => !allowed.includes(name))) throw new Error('benchmark catalog is not isolated')
    fs.writeFileSync(join(config.root, 'catalog.json'), JSON.stringify(advertised))
  }, { global: true })
  const faultPath = join(config.root, 'fault-injected.json')
  let injected = fs.existsSync(faultPath), calls = 0
  ctx.tools.guard(exec => {
    let denied = !allowed.includes(exec.name) ? 'not-allowed' : ++calls > maxCalls ? 'budget' : null
    if (!denied && config.injectFault && exec.name === 'redteam_http_evidence_add' && !injected) {
      injected = true
      fs.writeFileSync(faultPath, JSON.stringify({ runId: config.runId }), { flag: 'wx' })
      denied = 'synthetic-transient'
    }
    fs.appendFileSync(join(config.root, 'calls.jsonl'), JSON.stringify({ name: exec.name,
      action: exec.name === 'redteam_task_run' ? exec.arguments?.action : null, denied }) + '\n')
    if (denied === 'synthetic-transient') return 'Synthetic ETIMEDOUT before any write. Fixture unchanged; one explicit retry is safe.'
    if (denied) return 'Benchmark permits only its synthetic record tools within the per-process call budget.'
  })
  const readyPath = join(config.root, 'ready.json')
  const ready = { arm: config.arm, allowed, runId: config.runId, knowledgeScope: 'synthetic-only' }
  if (fs.existsSync(readyPath)) {
    if (JSON.stringify(JSON.parse(fs.readFileSync(readyPath, 'utf8'))) !== JSON.stringify(ready)) throw new Error('benchmark readiness identity mismatch')
  } else fs.writeFileSync(readyPath, JSON.stringify(ready), { flag: 'wx' })
}
