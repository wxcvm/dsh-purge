/**
 * Read-only task-to-tool suggestions. Do not infer that a local binary path
 * implies a runnable tool, or that a version check means a target was scanned.
 */
import { TOOL_CATALOG, loadPlatformConfig, resolveTool } from './platform-config.js'
import { probeInstalledTool } from './tool-health.js'

const EXECUTION_ADAPTERS = Object.freeze({ nmap: 'redteam_scan_run', httpx: 'redteam_scan_run' })

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
 * Score only facts we actually have: local path presence, a supported version
 * probe, the existing source precedence and a user's optional preference.
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
    return { ...candidate, score, reasons, dependencyStatus: 'not-checked',
      capabilityVerified: false, executionStatus: 'not-run',
      executionSupported: !!executionAdapter, executionAdapter,
      executionMode: executionAdapter ? 'dedicated-adapter' : 'requires-matching-skill-and-host-tool',
      executionNote: executionAdapter
        ? '有专用结构化执行适配器；仍需通过授权范围门禁。'
        : '没有专用执行适配器；仅在匹配 Skill 与真实宿主 Shell/MCP 接口均可用时执行，不自动猜测命令。',
      _order: index }
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
      executionStatus: 'not-supported',
      note: '自定义工具仅展示配置与路径状态；未提供任务分类、参数 schema 和专用适配器，不会自动执行。',
    }
  })
  return {
    ok: true, task, label: profile.label,
    status: selected ? 'located' : 'missing',
    preferredToolId: preferredId || null,
    selected, candidates: ranked, configuredCustomTools,
    note: selected
      ? '仅依据本机路径、可探针信息和已保存的首选工具推荐；评分不是验证或执行结果。'
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
