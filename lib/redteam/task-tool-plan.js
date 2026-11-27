/**
 * Read-only task-to-tool suggestions. Do not infer that a local binary path
 * implies a runnable tool, or that a version check means a target was scanned.
 */
import { TOOL_CATALOG, loadPlatformConfig, resolveTool } from './platform-config.js'
import { probeInstalledTool } from './tool-health.js'

const EXECUTION_ADAPTERS = Object.freeze({
  nmap: 'redteam_scan_run', httpx: 'redteam_scan_run',
  subfinder: 'redteam_passive_recon', dnsx: 'redteam_passive_recon', amass: 'redteam_passive_recon',
})

/*
 * A tool path is not an invocation contract. Keep the reviewed Skill mapping,
 * scope requirement and execution policy beside the task planner so the UI and
 * agent receive the same facts. Planning never executes a tool.
 */
export const TOOL_USE_CONTRACTS = Object.freeze({
  nmap: { skillKeys: ['redteam:nmap-service-inventory'], executionPolicy: 'dedicated-adapter',
    operatorConfirmationRequired: false, policyNote: '仅通过 redteam_scan_run 对单个已登记授权目标执行；使用固定参数、范围门禁和原始输出证据，不复制旧 Skill 命令。' },
  httpx: { skillKeys: ['redteam:httpx-web-inventory'], executionPolicy: 'dedicated-adapter',
    operatorConfirmationRequired: false, policyNote: '仅通过 redteam_scan_run 对单个已登记授权目标执行；不使用 Python httpx，不扩展为爬取、目录枚举或表单操作。' },
  subfinder: { skillKeys: ['redteam:passive-recon'], executionPolicy: 'dedicated-adapter',
    operatorConfirmationRequired: true, policyNote: '仅通过 redteam_passive_recon 固定被动模式；每次向外部数据源提交域名前必须取得明确同意。' },
  dnsx: { skillKeys: ['redteam:passive-recon'], executionPolicy: 'dedicated-adapter',
    operatorConfirmationRequired: true, policyNote: '仅通过 redteam_passive_recon 解析已保存子域快照；固定 A/AAAA/CNAME 查询，不做字典枚举、AXFR 或追踪。' },
  amass: { skillKeys: ['redteam:passive-recon'], executionPolicy: 'dedicated-adapter',
    operatorConfirmationRequired: true, policyNote: '仅通过 redteam_passive_recon 的固定被动模式；每次向外部数据源提交根域名前必须取得明确同意。' },
  ksubdomain: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '主动子域枚举尚无经过审查的窄范围适配器；当前不执行，不读取旧版爆破流程。' },
  naabu: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '主动端口探测尚无独立的范围/速率/结果契约；当前不执行。可使用已审查的单目标 Nmap 适配器。' },
  masscan: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '高影响端口扫描尚无专用安全适配器；当前不执行。' },
  nuclei: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '模板行为与副作用差异较大，尚无模板类别 allowlist 和逐模板执行契约；当前不执行 PoC/漏洞模板。' },
  fscan: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '旧 Skill 包含凭据尝试及高影响内网工作流；在替换为只读、范围受限的盘点适配器前不执行。' },
  gogo: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '旧 Skill 包含大范围主动测绘及低可见度指导；在收窄范围和结果契约前不执行。' },
  smbclient: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '没有经过审查的 SMB 只读调用契约；不得猜测参数或尝试凭据。' },
  netexec: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '没有经过审查的 NetExec 只读调用契约；不得执行身份枚举或凭据操作。' },
  impacket: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: 'Impacket 包含多种高影响工具；没有逐工具审查的只读调用契约，不得执行。' },
  suo5: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '不创建或部署目标侧隧道；仅接受另行审查的操作者预配置隧道可达性验证流程。' },
  frpc: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '不在目标侧部署客户端或建立反向通道；当前没有受限执行适配器。' },
  frps: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '不启动或开放隧道服务端；当前没有绑定地址、端口和生命周期的受限适配器。' },
  chisel: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '不创建转发、反向代理或多跳隧道；当前没有受限执行适配器。' },
  ffuf: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '目录/路径枚举尚无固定目标、请求上限和只读结果契约；当前不执行。' },
  feroxbuster: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '递归目录枚举尚无固定深度、请求上限和只读结果契约；当前不执行。' },
  gowitness: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: '浏览器访问可能触发状态变更；尚无只读导航和请求拦截契约，当前不执行。' },
  testssl: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: 'TLS 主动探测尚无单目标调用和结果契约；当前不执行。' },
  katana: { skillKeys: [], executionPolicy: 'unmapped-manual-review',
    operatorConfirmationRequired: true, policyNote: 'Web 爬取尚无请求深度、速率、登录态和状态变更约束；当前不执行。' },
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
      executionMode: executionAdapter ? 'dedicated-adapter'
        : contract.executionPolicy === 'unmapped-manual-review' ? 'unmapped-manual-review'
          : 'requires-matching-skill-and-host-tool',
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
  const selected = ranked.find((item) => item.detected && item.executionPolicy !== 'unmapped-manual-review')
    || ranked.find((item) => item.detected) || null
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
    note: selected?.executionPolicy === 'unmapped-manual-review'
      ? '检测到工具路径，但当前没有经过审查的调用契约；仅展示路径或执行本地版本探针，不得执行目标任务。'
      : selected
        ? '仅依据本机路径、任务顺序、工具来源和已保存的用户首选推荐；版本探针能力只作信息展示，不加分，也不代表实际执行。'
        : '没有找到本任务对应的已知工具；可检查路径或继续进行本地记录核查。',
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
