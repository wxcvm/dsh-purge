/**
 * Tiny task dispatcher: advisory hints only, no model, network, tool execution,
 * or inferred permissions. Every suggestion has a deterministic reason.
 */
const INTENT_RULES = [
  { kind: "development", profile: "coding", match: /(?:代码|编译|调试|修复程序|测试用例|CI|构建失败|代码审查|\b(?:code|debug|build|unit tests?|pull request|CI)\b)/i,
    capabilities: ["repository", "test-runner"] },
  { kind: "writing", profile: "writing", match: /(?:写作|翻译|改写|润色|写邮件|\b(?:translate|rewrite|proofread|draft)\b)/i,
    capabilities: ["document-editor"] },
  { kind: "research", profile: "research", match: /(?:资料研究|调研|查证|对比资料|\b(?:research|compare sources)\b)/i,
    capabilities: ["source-search"] },
  { kind: "security-review", profile: "redteam", match: /(?:红队演练|授权渗透测试|安全评估|漏洞审查|\b(?:red.team assessment|security review)\b)/i,
    capabilities: ["scope-verification", "evidence-review"] },
];

export function suggestTaskDispatch({ text = "", profileId = null, availableCapabilities = [] } = {}) {
  const task = String(text || "");
  if (!task.trim()) return { kind: "unknown", reason: "empty-task", capabilities: [], subagent: "not-suggested", readOnly: true };
  const route = INTENT_RULES.find(rule => rule.profile === profileId) ||
    (profileId ? null : INTENT_RULES.find(rule => rule.match.test(task)));
  if (!route) return { kind: "general", reason: profileId ? "unmapped-profile" : "no-task-match", capabilities: [], subagent: "not-suggested", readOnly: true };
  const known = new Set(Array.isArray(availableCapabilities) ? availableCapabilities.filter(v => typeof v === "string") : []);
  const explicitParallel = /(?:并行|同时处理|分别检查|两个仓库|多个项目|\b(?:in parallel|multiple repositories)\b)/i.test(task);
  return {
    kind: route.kind,
    reason: profileId ? "selected-profile" : "explicit-task-pattern",
    capabilities: route.capabilities.map(id => ({ id, available: known.has(id) ? true : "not-observed" })),
    subagent: explicitParallel ? "consider" : "not-suggested",
    readOnly: true,
  };
}
