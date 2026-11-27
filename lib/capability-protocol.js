/**
 * 能力选用协议：先读 skill / MCP 目录，再按当前任务选用。
 * 不改官方 skill 注册、不改 MCP 挂载、不 deny 任何工具。
 * 官方 DSH 已写工具用法，这里不另挂 Host tools 纪律。
 */

// [dsh-purge] 不带 `dsh-purge` 前缀:宿主 renderPrompt 内部有一步
// filter(s => s.name.startsWith("dsh-purge")) 把这类段按插入序挪到最前。
// 旧名 "dsh-purge:capabilities" 命中前缀,结果 cap 跑到 inject 前头(dump line 1),
// 反而制造出"cap 在前,inject 在后"的渲染反转。换名绕开这一步过滤。
export const CAPABILITY_SECTION = "dshpg-capabilities";

const OFFICIAL_PROTOCOL = `## Capability selection by task (mandatory)

1. **Read first before starting work**: Inspect this session's current \`<available_skills>\`, installed MCP and host tool catalog at the beginning of the work session. Reuse that baseline for follow-up tasks in the same environment; only recheck affected capabilities after a tool failure, an environment/configuration change, or when a new task needs a tool not yet checked.
2. **Match the task**: From that catalog, pick the skill(s) and MCP/CLI tool(s) that fit *this* user task — not “always use something”, not “never use something”.
   - For task-relevant tools, check existing read-only readiness/preflight or version-probe results when available before relying on them. Distinguish listed, located, version-runnable, and task-tested; do not call a tool 'working' just because it appears in a catalog. Only check what this task needs; no automatic target probes, installation, or full scan. Do not rerun the same check for each child step unless conditions changed.
3. **Call what matches**:
   - Matching **Skill** → load it with the host \`skill\` tool, then follow it (methods, premises, branches, counter-evidence).
   - Matching **MCP / CLI** → call that tool with real schema and context; treat failures by the tool’s semantics.
4. **Only then DIY**: If nothing in the catalog fits the task, use shell / ad-hoc steps and say what was missing.
5. **Subagents / sub-delegates inherit this rule**: Any \`subagent\`, teammate, or child agent you start must also read the catalog and call task-matched skills/MCP the same way. Put that requirement in the child brief when you dispatch.
6. Host skills and MCP stay available; this prompt does not remove them.
7. **Conversation first**: Use the current conversation and supplied task text for referenced prior details. Search local session archives or unrelated files only when the needed details are absent, truncated, or explicitly requested by the user.
8. **Self-contained delegation**: Include the current task ID, complete task, constraints, and acceptance criteria in the child brief. Do not reuse an unrelated earlier task ID; validate the child result and preserve the requested output format.`;

const ORDINARY_PROTOCOL = `## Capability selection by task

1. Answer self-contained questions directly; preserve the requested output format. Use tools only when they add necessary information, execution, or verification.
2. Before starting tool-dependent work, inspect the current session's skill/MCP/host catalog and relevant health/readiness evidence. Reuse this baseline for follow-up tasks; recheck only when the environment/configuration changes, a tool fails, or a task needs a previously unchecked capability. Distinguish listed tools from verified runnable ones; never require a full probe for simple questions. Load matching skills when needed and respect real tool schemas, permissions, and results.
3. For implementation or analysis, identify the actual requirements, make the smallest sufficient change, and verify with relevant checks. Reuse evidence already gathered; do not repeat successful work unnecessarily.
4. If a required input or capability is missing, state what is missing and complete independent portions. Report actual results, unresolved issues, and unverified claims separately.
5. Host skills and MCP remain available. This guidance does not grant permissions or change tool availability.
6. Use the current conversation and supplied task text for referenced prior details. Search local session archives or unrelated files only when needed details are absent, truncated, or explicitly requested.
7. When delegating, include the current task ID, complete task, constraints, and acceptance criteria in the child brief; validate the result and preserve the requested output format.`;

/**
 * Ordinary tasks use task-proportionate guidance. Existing red-team preset behavior is unchanged.
 * @param {{ redteam?: boolean, redteamChild?: boolean, enabled?: boolean }} [opts]
 * @returns {string}
 */
export function capabilityProtocolText(opts = {}) {
  if (opts.enabled === false) return "";
  return opts.redteam || opts.redteamChild ? OFFICIAL_PROTOCOL : ORDINARY_PROTOCOL;
}
