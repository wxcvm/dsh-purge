/**
 * Read-only task-to-tool suggestions. Do not infer that a local binary path
 * implies a runnable tool, or that a version check means a target was scanned.
 */
import { TOOL_CATALOG, loadPlatformConfig, resolveTool } from './platform-config.js'
import { probeInstalledTool } from './tool-health.js'

const EXECUTION_ADAPTERS = Object.freeze({ nmap: 'redteam_scan_run', httpx: 'redteam_scan_run' })

/*
 * A tool path is not an invocation contract. Keep the reviewed Skill mapping,
 * scope requirement and execution policy beside the task planner so the UI and
 * agent receive the same facts. Planning never executes a tool.
 */
export const TOOL_USE_CONTRACTS = Object.freeze({
  nmap: { skillKeys: ['redteam:active-scan'], executionPolicy: 'dedicated-adapter',
    operatorConfirmationRequired: false, policyNote: '必须通过 redteam_scan_run；由适配器执行授权范围门禁，不能复制 Skill 中的原始命令。' },
  httpx: { skillKeys: ['redteam:recon-pipeline', 'redteam:web-fingerprint'], executionPolicy: 'dedicated-adapter',
    operatorConfirmationRequired: false, policyNote: '必须通过 redteam_scan_run；由适配器执行授权范围门禁，不能直接调用 Python httpx。' },
  subfinder: { skillKeys: ['redteam:passive-recon', 'redteam:recon-pipeline'], executionPolicy: 'skill-guided-host-tool',
    operatorConfirmationRequired: false, policyNote: '被动信息收集；仅使用当前会话真实可用的宿主工具，并先核对用户明确提供的资产范围。' },
  dnsx: { skillKeys: ['redteam:recon-pipeline'], executionPolicy: 'skill-guided-host-tool',
    operatorConfirmationRequired: false, policyNote: '仅执行范围内的 DNS 查询；不得把解析关联推断为授权。' },
  amass: { skillKeys: ['redteam:passive-recon'], executionPolicy: 'skill-guided-host-tool',
    operatorConfirmationRequired: false, policyNote: '优先使用被动数据源；不得自动扩大域名或组织范围。' },
  ksubdomain: { skillKeys: ['redteam:recon-pipeline'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '主动枚举；需要针对本次目标和查询量的明确确认，不得默认启动。' },
  naabu: { skillKeys: ['redteam:recon-pipeline', 'redteam:active-scan'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '主动端口探测；需要明确目标、授权范围和本次执行确认。' },
  masscan: { skillKeys: ['redteam:active-scan'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '高影响主动端口探测；本项目不提供自动执行，需明确目标、范围、速率与单次确认。' },
  nuclei: { skillKeys: ['redteam:nuclei-scan'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '漏洞模板扫描；需明确目标、模板类别、范围和单次确认，不自动执行利用性模板。' },
  fscan: { skillKeys: ['redteam:fscan-intranet'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '仅人工审核后考虑授权范围内的低影响盘点；禁止口令爆破、拒绝服务、持久化、规避检测和超范围操作。' },
  gogo: { skillKeys: ['redteam:gogo-intranet'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '内网主动测绘仅限明确授权范围；禁止规避检测、持久化和超范围操作。' },
  smbclient: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '当前没有经过审查的 smbclient 调用 Skill/参数契约；不得猜测参数或尝试凭据。' },
  netexec: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '当前没有经过审查的 NetExec 调用契约；不得自动执行身份枚举或凭据操作。' },
  impacket: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: 'Impacket 包含多种高影响工具；当前没有逐工具审查的调用契约，不得自动执行。' },
  suo5: { skillKeys: ['redteam:suo5-tunnel'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '隧道会改变流量路径；必须明确入口、监听地址、授权范围和单次确认；禁止持久化部署。' },
  frpc: { skillKeys: ['redteam:frp-tunnel'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '隧道会改变流量路径；必须明确入口、监听地址、授权范围和单次确认；禁止持久化部署。' },
  frps: { skillKeys: ['redteam:frp-tunnel'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '服务端隧道需要明确绑定地址、开放端口、授权范围和单次确认；禁止持久化部署。' },
  chisel: { skillKeys: ['redteam:chisel-tunnel'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '隧道会改变流量路径；必须明确入口、监听地址、授权范围和单次确认；禁止持久化部署。' },
  ffuf: { skillKeys: ['redteam:dir-bruteforce'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '主动 Web 路径探测；需要明确目标、授权范围、请求速率和单次确认。' },
  feroxbuster: { skillKeys: ['redteam:dir-bruteforce'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '主动 Web 路径探测；需要明确目标、授权范围、请求速率和单次确认。' },
  gowitness: { skillKeys: ['redteam:browser-automation'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '浏览器访问会产生目标请求；需要明确目标范围和单次确认。' },
  testssl: { skillKeys: ['redteam:web-fingerprint'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: 'TLS 主动检查需要明确目标范围和单次确认；不得扫描范围外主机。' },
  katana: { skillKeys: ['redteam:recon-pipeline'], executionPolicy: 'manual-review-only',
    operatorConfirmationRequired: true, policyNote: '主动 Web 爬取；需要明确目标范围、深度/请求量和单次确认。' },
})

const DEFAULT_TOOL_USE_CONTRACT = Object.freeze({
  skillKeys: [], executionPolicy: 'unmapped-manual-review',
  operatorConfirmationRequired: true,
  policyNote: '没有经过审查的工具调用契约；不得猜测命令或通过通用 Shell 自动执行。',
})

export function toolUseContract(toolId) {
  const contract = TOOL_USE_CONTRACTS[toolId] || DEFAULT_TOOL_USE_CONTRACT
  return {
    executionPolicy: contract.executionPolicy,
    requiresScopeReview: true,
    operatorConfirmationRequired: contract.operatorConfirmationRequired === true,
    automaticExecutionAllowed: false,
    policyNote: contract.policyNote,
    skillRequirements: contract.skillKeys.map((key) => ({
      key,
      name: key.slice('redteam:'.length),
      required: true,
      loadTool: 'redteam_skill_read',
      status: 'not-read',
    })),
  }
}

export const TASK_TOOL_PROFILES = [
  { id: 'domains', label: '域名与 DNS 资产', toolIds: ['subfinder', 'dnsx', 'ksubdomain', 'amass'] },
  { id: 'services', label: '端口与服务盘点', toolIds: ['nmap', 'naabu', 'masscan'] },
  { id: 'web', label: 'Web 资产梳理', toolIds: ['httpx', 'katana', 'ffuf', 'feroxbuster', 'gowitness'] },
  { id: 'vulns', label: '漏洞检测准备', toolIds: ['nuclei', 'nmap', 'testssl'] },
  { id: 'internal', label: '内部网络资产盘点', toolIds: ['gogo', 'fscan', 'nmap', 'smbclient', 'netexec'] },
  { id: 'identity', label: '身份服务检查准备', toolIds: ['impacket', 'netexec', 'smbclient'] },
  { id: 'connectivity', label: '网络连接工具准备', toolIds: ['chisel', 'frpc', 'suo5'] },
]

export function listTaskToolProfiles() {
  return TASK_TOOL_PROFILES.map(({ id, label, toolIds }) => ({ id, label, toolIds: [...toolIds] }))
}

/**
 * Score only local path presence, source precedence and a user's optional
 * preference. Probe support is metadata only and never adds ranking points.
 * No probe or task is executed during planning.
 */
export function rankTaskCandidates(candidates, preferredId = '') {
  const sourceBonus = { config: 8, toolkit: 6, binDir: 4, path: 2, artex: 1 }
  return candidates.map((candidate, index) => {
    const reasons = []
    let score = candidate.detected ? 100 : 0
    if (candidate.detected) {
      reasons.push('本机已定位程序路径')
      if (candidate.canProbe) reasons.push('支持显式版本检测（尚未运行；不代表工具优先级更高）')
      if (candidate.id === preferredId) { score += 100; reasons.push('用户首选工具') }
      score += sourceBonus[candidate.source] || 0
      if (sourceBonus[candidate.source]) reasons.push('来源：' + candidate.source)
    } else reasons.push('当前本机未找到程序')
    const executionAdapter = EXECUTION_ADAPTERS[candidate.id] || null
    const contract = toolUseContract(candidate.id)
    return {
      ...candidate, score, reasons, dependencyStatus: 'not-checked',
      capabilityVerified: false, executionStatus: 'not-run',
      executionSupported: !!executionAdapter, executionAdapter,
      executionMode: executionAdapter ? 'dedicated-adapter' : 'requires-matching-skill-and-host-tool',
      executionPolicy: contract.executionPolicy,
      requiresScopeReview: contract.requiresScopeReview,
      operatorConfirmationRequired: contract.operatorConfirmationRequired,
      automaticExecutionAllowed: contract.automaticExecutionAllowed,
      skillRequirements: contract.skillRequirements,
      executionNote: contract.policyNote,
      policyNote: contract.policyNote,
      _order: index,
    }
  }).sort((a, b) => b.score - a.score || a._order - b._order)
    .map(({ _order, ...candidate }) => candidate)
}
export function planTaskTools(task, options = {}) {
  const profile = TASK_TOOL_PROFILES.find((item) => item.id === task)
  if (!profile) return { ok: false, task, error: '未知任务类型', profiles: listTaskToolProfiles() }
  const cfg = options.config || loadPlatformConfig(options.root)
  const candidates = profile.toolIds.map((id) => {
    const binary = resolveTool(id, { ...options, config: cfg })
    const def = TOOL_CATALOG.find((item) => item.id === id)
    return {
      id, label: def?.label || id, path: binary.path, source: binary.source,
      detected: !!binary.path, canProbe: !!def?.probeArgs,
      dependencyNote: def?.dependencyNotes || null,
      verification: 'not-run',
    }
  })
  const preferredId = cfg.planning?.preferredToolByTask?.[task] || ''
  const ranked = rankTaskCandidates(candidates, preferredId)
  const selected = ranked.find((item) => item.detected) || null
  const configuredCustomTools = (cfg.customTools || []).map((_entry, index) => {
    const item = resolveTool('custom:' + index, { ...options, config: cfg })
    return {
      id: item.id, label: item.label, path: item.path || null,
      configuredPath: item.configured || null, source: item.source,
      detected: !!item.path, taskFit: 'unclassified',
      executionSupported: false, executionAdapter: null,
      executionStatus: 'not-supported', executionMode: 'unmapped-manual-review',
      executionPolicy: 'unmapped-manual-review', requiresScopeReview: true,
      operatorConfirmationRequired: true, automaticExecutionAllowed: false,
      skillRequirements: [],
      note: '自定义工具仅展示配置与路径状态；未提供经过审查的任务分类、Skill 和参数 schema，不会自动执行。',
    }
  })
  return {
    ok: true, task, label: profile.label,
    status: selected ? 'located' : 'missing',
    preferredToolId: preferredId || null,
    selected, candidates: ranked, configuredCustomTools,
    skillPlan: {
      status: selected ? (selected.skillRequirements.length ? 'read-required' : 'manual-review') : 'not-applicable',
      selectedToolId: selected?.id || null,
      requirements: selected?.skillRequirements || [],
      readTool: 'redteam_skill_read',
      note: '技能正文尚未读取；按 key 读取成功后才能按对应执行策略继续。缺失/读取失败时停止，不得猜测命令。',
    },
    executionGuard: {
      scopeReviewTool: 'redteam_scope_review',
      scopeReviewIsAuthorizationProof: false,
      prohibitedActions: ['password-bruteforce', 'denial-of-service', 'persistence', 'evasion', 'out-of-scope'],
      automaticExecution: false,
    },
    note: selected
      ? '仅依据本机路径、任务顺序、工具来源和已保存的用户首选推荐；版本探针能力只作信息展示，不加分，也不代表实际执行。'
      : '没有找到本任务对应的已知工具；可检查路径或使用其他现有工具。',
  }
}

export async function verifyTaskTool(task, options = {}) {
  const plan = planTaskTools(task, options)
  if (!plan.ok || !plan.selected) return { ...plan, verification: null }
  const verification = await probeInstalledTool(plan.selected.id, options)
  return {
    ...plan,
    verification,
    status: verification.status === 'runnable' ? 'version-verified'
      : verification.status === 'path-only' ? 'path-only' : 'verification-failed',
    note: verification.status === 'runnable'
      ? '所选工具的本地版本命令执行成功；未向任何目标发送请求，不表示实际测试任务成功。'
      : '工具未通过版本命令验证（或没有适用版本参数）；不代表目标测试结果。',
  }
}
