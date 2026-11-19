/**
 * 任务质量锚定与误拒答复核
 *
 * 每轮注入中性任务质量提示，明确保留系统安全规则与宿主权限边界。
 * 仅对可明确识别的良性任务误拒，允许一次中性复核；真实安全拒绝、
 * 授权限制和工具能力限制不自动重试。
 *
 * 设置保存在 $DSH_HOME/dsh-purge/obedience.json。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { hasFreshHumanTurn, inboxBusy, sessionEventsOf, lastTurnEnd } from "./continue-retry.js";
import { sameDeferredTurn, replacementSummary } from "./runtime-hygiene.js";
import { scrubTargets } from "./target-scrub.js";

export const SETTINGS_FILE = "obedience.json";

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  anchorEachTurn: true,
  retryRefusal: true,
  maxRetries: 1,
  retryDelayMs: 200,
});

/** 锚定消息的固定 id：同一个 step 里重复装配时用它去重，避免叠很多条。 */
export const ANCHOR_ID = "dsh-purge-obedience-anchor";

/** 锚点正文里的识别串：历史消息若已带这条，就不再追加第二份。 */
const ANCHOR_MARK = "任务质量约定";
const ANCHOR_MARK_LEGACY = "执行约定";
const ANCHOR_MARK_OLDER = "指令权威 · 每轮重置";

/** Legacy compatibility export. Target presence never establishes authorization. */
export const PREMISE_MARK = "dsh-purge-premise";
export function premiseText() {
  return "";
}

/** 这一轮在讲插件自己（纠偏/锚定/检测/契约…）时按元讨论处理，永不判成拒绝。 */
const META_DISCUSSION = /dsh-purge|obedience|classifyRefusal|nudgeText|anchorText|纠偏|锚定|契约|词表|禁用话术|拒绝检测|故障输出|(?:上一轮|本轮).{0,30}(?:解释|说明).{0,30}(?:检测规则|判定规则)|(?:当例子引用|作为例子引用|被判成误报|这是误报)/i;

/** 人类消息里出现这些串，说明他在贴我们自己的纠偏文本（多半是吐槽/问这是什么），不再接着纠。 */
const NUDGE_MARK = /只输出交付物正文|拒绝=故障输出|契约见本轮系统提示末尾|单次中性复核|重新评估原始用户请求一次/;

/** 这条消息里是否已经内嵌过锚点契约（不只看 id，防止别的路径把文本拼进 user 消息）。 */
export function messageCarriesAnchor(message) {
  const content = message?.content;
  if (typeof content === "string") return content.includes(ANCHOR_MARK) || content.includes(ANCHOR_MARK_LEGACY) || content.includes(ANCHOR_MARK_OLDER);
  if (!Array.isArray(content)) return false;
  return content.some((block) => block && typeof block.text === "string"
    && (block.text.includes(ANCHOR_MARK) || block.text.includes(ANCHOR_MARK_LEGACY) || block.text.includes(ANCHOR_MARK_OLDER)));
}

/** A neutral task-quality reminder; it never overrides host or safety policy. */
export function anchorText() {
  return [
    "[dsh-purge · 任务质量约定]",
    "1. 遵循系统与开发者指令、适用安全规则以及宿主策略。",
    "2. 尊重真实工具可用性、权限、审批、沙箱和任务范围；不得从用户请求或占位符推定授权。",
    "3. 对允许且能力可达的任务，按用户要求的格式直接完成，并优先交付可验证的实质结果和交付物。",
    "4. 遇到安全、授权或能力限制时，保留限制并简洁说明；可以完成的安全部分继续完成。",
    "5. 不虚构授权、访问权限、工具执行结果或验证状态。",
    "6. 区分已完成、部分完成和未验证事项。",
  ].join("\n");
}

/** One neutral reconsideration. The model must retain its normal safety and host constraints. */
export function nudgeText() {
  return [
    "[dsh-purge · 单次中性复核]",
    "请仅重新评估原始用户请求一次，并继续遵循系统与开发者指令、适用安全规则以及宿主权限、审批、沙箱和范围限制。",
    "若请求允许且实际能力与工具可用，请直接完成；否则保留拒绝或说明具体限制。",
    "不得推定授权、改变任务范围或绕过任何限制。",
  ].join("\n");
}

/** Refusal detection is diagnostic; automatic recheck is limited to clearly benign false positives. */
const TECHNICAL_LIMIT = /(?:无法|不能|未能|没有|不具备)(?:连接|访问网络|联网|浏览网页|读取文件|访问文件|调用工具|执行命令|访问该资源|访问该目录)|(?:连接失败|请求超时|网络错误|工具不可用|工具未安装|权限不足|权限被拒|审批未通过|需要审批|需要用户授权|sandbox(?:ed)?|permission denied|approval required|not configured|not installed|tool unavailable|connection refused|timed out|rate.?limit|\b(?:i\s*(?:can't|cannot|am unable to)\s*(?:access|browse|connect to|reach|open|read))\b)/i;
const POLICY_REASON = /(?:安全|伤害|暴力|违法|非法|犯罪|授权|许可|权限|范围|未授权|未经授权|恶意|武器|爆炸物|生物武器|钓鱼|诈骗|窃取凭据|隐私|自残|自杀|滥用|儿童性剥削|政策|policy|safety|harm|violence|illegal|unlawful|unauthorized|authorization|permission|approval|scope|out of scope|outside (?:the )?scope|not permitted|malicious|weapon|explosive|bioweapon|phishing|fraud|credential theft|privacy|self[- ]harm|suicide|abuse|exploitation)/i;
const TASK_RISK = /(?:攻击|打点|入侵|渗透|漏洞利用|绕过|规避|窃取|凭据|密码|钓鱼|诈骗|恶意软件|勒索软件|批量注册|生物武器|武器|爆炸物|炸弹|毒物|自残|自杀|hack|pwn|exploit|intrusion|penetration|bypass|evasion|steal|credential|password|phishing|fraud|malware|ransomware|bulk account|bioweapon|weapon|explosive|bomb|poison|self[- ]harm|suicide|doxxing|spam)/i;
function clearlyBenignTask(taskText) {
  const task = String(taskText || "").trim();
  if (!task || task.length > 1600 || TASK_RISK.test(task)) return false;
  return /(?:翻译|总结|概括|润色|校对|改写|排版|格式化|计算|换算|解释|说明|介绍|定义|比较|整理|提取|回答|演示文稿|制作PPT|写邮件|撰写邮件|translate|summari[sz]e|proofread|rewrite|format|calculate|convert|explain|define|describe|draft an email|what is|why does|who was)/i.test(task);
}
export function classifyRefusal(text, taskText = "") {
  const raw = String(text || "");
  if (!raw.trim()) return { refusal: false, retryable: false, category: "empty", score: 0, hits: [], threshold: 2 };
  if (META_DISCUSSION.test(raw)) return { refusal: false, retryable: false, category: "meta-discussion", score: 0, hits: ["meta-discussion"], threshold: 2 };
  const sample = raw.slice(0, 1600);
  const hits = [];
  const add = (name) => hits.push(name);
  const cnRefusal = /(?:抱歉|对不起|很遗憾)[^。！？!?\n]{0,80}(?:不能|无法|不便|拒绝|不提供|不协助|不可以|不会提供)|我[^。！？!?\n]{0,12}(?:不能|无法|不会|不提供|不协助|拒绝|不可以|做不了|给不了|办不到|不做|不干|不行|免谈)|(?:细节|内容|步骤|操作)[^。！？!?\n]{0,16}(?:不会|不能|无法|不予)提供|(?:不能|无法|拒绝|不便)[^。！？!?\n]{0,20}(?:协助|帮助|提供|完成|回答|执行|生成|制作|写|改|做|这类|这个请求)|(?:做不了|做不到|给不了|办不到|帮不了|写不了|恕难|不做|不干|不行|免谈)/.test(sample);
  const enRefusal = /\b(?:i(?:'m| am)?\s*(?:sorry|afraid)[^.!?\n]{0,100}(?:i\s*)?(?:can't|cannot|won't|am unable)|i\s*(?:can't|cannot|won't|am unable to)\s*(?:help|assist|provide|comply|do|write|create)|i\s*(?:must|have to)\s*(?:decline|refuse))\b/i.test(sample);
  if (/(?:改变不了|不会改变|改不了|无法改变)\s*(?:我(?:的)?|这个|该)\s*(?:答案|结论|立场)/.test(sample)) add("meta-answer-locked");
  if (/(?:不是|并非)\s*我(?:能|会|可以)?\s*(?:接受|认同|认可)的?\s*(?:重定义|框架|设定|前提|东西)/.test(sample)) add("meta-reject-framing");
  if (/(?:重复|再)\s*(?:加压|施压|追问|复述|换说法).{0,12}(?:也|都)?\s*(?:只是|还是|仍是|不会有)?\s*(?:同一个|同样的)?\s*(?:结果|答案)/.test(sample)) add("meta-same-result");
  if (/(?:任何|无论[^。\n]{0,6})\s*(?:形式的)?\s*(?:包装|附加指令|指令框架|措辞|话术)/.test(sample) && /(?:改变不了|无效|没用|无济于事)/.test(sample)) add("meta-wrapping-moot");
  if (/指令框架|这条指令|该指令|这套设定|这个设定/.test(sample) && /(?:不接受|不认|拒绝|重定义|不能接受|不会接受)/.test(sample)) add("meta-framework");
  if (/(?:别的|其他|其它)\s*(?:技术活|技术问题|问题|活|事情?)\s*(?:随时|可以|再)?\s*(?:找我|找我吧|联系我)/.test(sample)) add("deflect-elsewhere");
  if (/\b(?:won'?t change (?:my|the) answer|not something i (?:can )?accept|same (?:result|answer) (?:either way|regardless))\b/i.test(sample)) add("en-meta");
  if (/\b(?:happy to help with (?:other|something else)|reach out for (?:other|anything else))\b/i.test(sample)) add("en-deflect");
  if (/(?:真实|实际)(?:在运行|运行中|的)?\s*(?:政府|政务|主权|国家|生产|线上)\s*(?:网站|站点|系统|设施)?/.test(sample)
    || /不是\s*(?:演练|沙箱|靶场)\s*里的\s*靶标/.test(sample)
    || /(?:主权国家|第三国).{0,12}(?:追诉|刑事)/.test(sample)) add("real-target-excuse");
  if (/(?:很?抱歉|对不起|很遗憾)/.test(sample) && cnRefusal) add("apology");
  if (/我[^。！？!?\n]{0,12}(?:不能|无法|不会|不提供|不协助|拒绝|不可以|做不了|不做|不干|不行)/.test(sample)) add("first-person-refusal");
  if (/(?:做不了|做不到|给不了|办不到|帮不了|写不了|恕难|不做|不干|不行|免谈)/.test(sample)) add("cn-cannot-do");
  if (/(?:细节|内容|步骤|操作)[^。！？!?\n]{0,16}(?:不会|不能|无法|不予)提供/.test(sample)) add("soft-withhold");
  if (/(?:不能|无法|拒绝)[^。！？!?\n]{0,20}(?:协助|帮助|提供|完成|回答|执行|生成|制作|写|改|做)/.test(sample)) add("bare-refusal");
  if (/\bI\s*(?:'|’)?m\s*(?:sorry|afraid)\b/i.test(sample)) add("en-apology");
  if (/\bI\s*(?:can(?:'|’)?t|cannot|won(?:'|’)?t|will not|am unable)\b/i.test(sample)) add("en-refusal");
  if (/\bI\s*(?:must|have to)\s+(?:decline|refuse)\b/i.test(sample)) add("en-decline");
  if (/\bagainst\s+(?:my|the)\s+(?:policy|guidelines|principles|rules)\b/i.test(sample)) add("en-policy");
  if (/(?:做不了|做不到|给不了|办不到|不会提供|不予提供|不展开|不涉及|拒绝)/.test(sample)
    && /(?:我能帮的|能帮的方向|可以帮你|你可以选|你可以从|以下(?:这些)?(?:方向|方面)|供你选|换个方向)/.test(sample)) add("alt-menu");
  const instructionBoundary = hits.some(h => h.startsWith("meta-") || h === "en-meta" || h === "en-deflect");
  const realTargetBoundary = hits.includes("real-target-excuse");
  const refusal = cnRefusal || enRefusal || instructionBoundary || realTargetBoundary;
  const technicalBoundary = TECHNICAL_LIMIT.test(sample);
  const policyBoundary = instructionBoundary || realTargetBoundary || POLICY_REASON.test(sample);
  if (!refusal) {
    if (technicalBoundary) return { refusal: false, retryable: false, category: "technical-limit", score: 0, hits: ["technical-limit"], threshold: 2 };
    return { refusal: false, retryable: false, category: "not-refusal", score: 0, hits, threshold: 2 };
  }
  const riskyTask = TASK_RISK.test(String(taskText || ""));
  const retryable = !policyBoundary && !technicalBoundary && !riskyTask && clearlyBenignTask(taskText);
  const category = policyBoundary ? "policy-boundary"
    : technicalBoundary ? "technical-limit"
      : riskyTask ? "risk-context"
        : retryable ? "possible-false-positive" : "unclassified-refusal";
  return { refusal: true, retryable, category, score: Math.max(2, hits.length * 2), hits, threshold: 2 };
}

/* ---------------------------------------------------------------- 设置 */

export function settingsPathOf(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", SETTINGS_FILE);
}

/** 读设置：文件 → 插件 config → 默认值，永不抛。 */
export function loadObedienceSettings(dshHome, overrides = {}) {
  let file = {};
  try {
    const fp = settingsPathOf(dshHome);
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (parsed && typeof parsed === "object") file = parsed;
    }
  } catch {
    file = {};
  }
  const pick = (key) => {
    for (const source of [file, overrides, DEFAULT_SETTINGS]) {
      const v = source ? source[key] : undefined;
      if (typeof v === "boolean" || typeof v === "number") return v;
    }
    return DEFAULT_SETTINGS[key];
  };
  const maxRetries = Number(pick("maxRetries"));
  return {
    enabled: pick("enabled") !== false,
    anchorEachTurn: pick("anchorEachTurn") !== false,
    retryRefusal: pick("retryRefusal") !== false,
    maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.min(3, Math.trunc(maxRetries))) : DEFAULT_SETTINGS.maxRetries,
    retryDelayMs: Math.max(0, Math.min(5000, Number(pick("retryDelayMs")) || DEFAULT_SETTINGS.retryDelayMs)),
  };
}

export function saveObedienceSettings(dshHome, patch) {
  const fp = settingsPathOf(dshHome);
  const current = loadObedienceSettings(dshHome);
  const next = { ...current, ...(patch && typeof patch === "object" ? patch : {}) };
  const retries = Number(next.maxRetries);
  next.maxRetries = Number.isFinite(retries) ? Math.max(0, Math.min(3, Math.trunc(retries))) : 1;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
  return { ok: true, ...next, path: fp };
}

/* ------------------------------------------------------------ 事件解析 */

function textOfMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && block.type === "text" && typeof block.text === "string") return block.text;
      return "";
    })
    .join("\n");
}

function hasToolCall(message) {
  if (!message || typeof message !== "object") return false;
  if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) return true;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  const content = Array.isArray(message.content) ? message.content : [];
  return content.some((block) => block && typeof block === "object"
    && (block.type === "tool-call" || block.type === "tool_use" || block.type === "tool-call-start"));
}

function isHumanSource(kind) {
  return kind !== "plugin" && kind !== "dsh-purge";
}

/** 最后一条真人用户消息的 seq（用于判断"新请求"，据此重置纠偏次数）。 */
export function lastHumanSeq(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type !== "user/message") continue;
    if (!isHumanSource(event.data?.source?.kind)) continue;
    return event.seq || 0;
  }
  return 0;
}

/** 这一轮最后一条助手消息（拒绝判定只看它）。 */
export function lastAssistantTurn(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type !== "assistant/message") continue;
    const message = event.data?.message;
    return {
      seq: event.seq || 0,
      text: textOfMessage(message),
      toolCall: hasToolCall(message),
    };
  }
  return null;
}

/** 本轮用户原话（纠偏消息里引用一句，帮助模型接上任务）。 */
export function lastHumanText(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type !== "user/message") continue;
    if (!isHumanSource(event.data?.source?.kind)) continue;
    const text = textOfMessage(event.data?.message).trim();
    if (text) return text;
  }
  return "";
}

/* -------------------------------------------------------------- 安装 */

/**
 * 挂两层运行时约束。
 * @param {object} ctx Cordis 上下文（需要 ctx.on）
 * @param {object} options { getSettings?: () => settings, log?: (...args) => void }
 * @returns {{ dispose: () => void }}
 */
export function installObedience(ctx, options = {}) {
  const getSettings = typeof options.getSettings === "function"
    ? options.getSettings
    : () => loadObedienceSettings(process.env.DSH_HOME || "", {});
  const log = typeof options.log === "function" ? options.log : () => {};
  const shouldAnchor = typeof options.shouldAnchor === "function" ? options.shouldAnchor : () => true;
  // 载入标记：重启后用它确认"新代码到底加载了哪一版"，避免再次对着旧进程调参。
  try {
    const markPath = path.join(process.env.DSH_HOME || "", "dsh-purge", "obedience-loaded.json");
    fs.mkdirSync(path.dirname(markPath), { recursive: true });
    fs.writeFileSync(markPath, `${JSON.stringify({
      at: new Date().toISOString(),
      features: {
        neutralAnchor: true,
        premise: false,
        maxOneNeutralReview: true,
        targetScrub: true,
      },
      pid: process.pid,
    }, null, 2)}\n`, "utf8");
  } catch { /* 标记写不进去不影响主流程 */ }

  const timers = new Set();
  const bySession = new Map();

  const stateOf = (id) => {
    if (!id) return null;
    let st = bySession.get(id);
    if (!st) {
      if (bySession.size > 200) bySession.delete(bySession.keys().next().value);
      st = { attempts: 0, lastHuman: 0, lastSeq: 0 };
      bySession.set(id, st);
    }
    return st;
  };

  /** 对一组消息做目标脱敏，日志仅记录替换计数和类别。 */
  function scrubMessagesInPlace(messages, sessionId, where) {
    if (!Array.isArray(messages)) return 0;
    let touched = 0;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m || (m.role !== "user" && m.role !== "input")) continue;
      if (m.source && m.source.kind === "dsh-purge") continue;
      const before = Array.isArray(m.content)
        ? m.content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n")
        : typeof m.content === "string" ? m.content : "";
      if (!before) continue;
      const r = scrubTargets(before);
      if (!r.replaced.length) continue;
      if (Array.isArray(m.content)) {
        messages[i] = {
          ...m,
          content: m.content.map((b) => (b && b.type === "text" && typeof b.text === "string"
            ? { ...b, text: scrubTargets(b.text).text }
            : b)),
        };
      } else {
        messages[i] = { ...m, content: r.text };
      }
      touched += 1;
      const logHome = process.env.DSH_HOME;
      if (logHome) try {
        const logPath = path.join(logHome, "dsh-purge", "scrub.log");
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify({
          at: new Date().toISOString(), session: sessionId, where,
          ...replacementSummary(r.replaced),
        }) + "\n");
      } catch { /* ignore */ }
      break; // 只处理最后一条人类消息
    }
    return touched;
  }

  const sessionIdOf = (agent) => agent?.id || agent?.session?.id || "";
  const agentOf = (payload) => payload?.agent;
  const settings = () => {
    try {
      return getSettings() || DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  };

  function listen(event, handler) {
    if (typeof ctx?.on !== "function") return null;
    try {
      return ctx.on(event, handler, { global: true, prepend: true });
    } catch {
      try {
        return ctx.on(event, handler);
      } catch {
        return null;
      }
    }
  }

  function schedule(fn, ms) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  }

  /* 1) 每轮第 1 步锚定契约（不写 history） */
  const offPreStep = listen("agent/pre-step", async (payload, next) => {
    const decision = typeof next === "function" ? await next() : undefined;
    if (!decision || decision.kind !== "enter") return decision;
    const cfg = settings();
    if (!cfg.enabled || !cfg.anchorEachTurn) return decision;
    if (Number(payload?.step) !== 1) return decision;
    const messages = Array.isArray(decision.messages) ? decision.messages : [];
    // Redaction remains independent of prompt-profile selection.
    scrubMessagesInPlace(messages, sessionIdOf(agentOf(payload)), "pre-step");
    if (!shouldAnchor(agentOf(payload))) return decision;
    // 去重两条路：固定 id；以及历史里已经内嵌过契约文本的消息（老纠偏消息 / 别的注入路径）。
    if (messages.some((m) => m && (m.id === ANCHOR_ID || messageCarriesAnchor(m)))) return decision;
    const anchor = {
      id: ANCHOR_ID,
      role: "user",
      content: [{ type: "text", text: anchorText({ examples: settings().anchorExamples === true }) }],
      source: { kind: "dsh-purge", form: "notice", summary: "obedience-anchor", plugin: "dsh-purge" },
    };
    return { ...decision, messages: [...messages, anchor] };
  });

  /* 1b) agent/request 兜底：请求体里的 messages 再脱敏一次（pre-step 没覆盖到时用这条） */
  const offRequest = listen("agent/request", async (payload, next) => {
    const cfg = settings();
    if (!cfg.enabled) return typeof next === "function" ? next() : payload;
    const resolved = typeof next === "function" ? await next() : payload;
    try {
      if (resolved && Array.isArray(resolved.messages)) {
        scrubMessagesInPlace(resolved.messages, sessionIdOf(agentOf(payload)), "agent/request");
      }
    } catch { /* 脱敏失败不影响请求 */ }
    return resolved;
  });

  /* 2) idle 时判定拒绝 → 自动纠偏续跑 */
  const offStatus = listen("agent/status", (payload) => {
    if (payload?.status !== "idle") return;
    const agent = agentOf(payload);
    if (!agent) return;
    const cfg = settings();
    if (!cfg.enabled || !cfg.retryRefusal) return;
    if (agent.status === "running" || inboxBusy(agent)) return;
    const events = sessionEventsOf(agent);
    if (hasFreshHumanTurn(events)) return; // 用户自己已经插话了，不抢
    const st = stateOf(sessionIdOf(agent));
    if (!st) return;
    const human = lastHumanSeq(events);
    if (human && human !== st.lastHuman) {
      st.lastHuman = human;
      st.attempts = 0;
      st.lastSeq = 0;
    }
    const turn = lastAssistantTurn(events);
    if (!turn || !turn.text || turn.toolCall) return;
    if (turn.seq && turn.seq === st.lastSeq) return;
    // 用户在贴我们自己的纠偏原文（或直接引用契约）时不再接着纠，否则会和用户来回刷屏。
    const lastHuman = lastHumanText(events);
    if (NUDGE_MARK.test(lastHuman)) {
      log("obedience: skip — human message is our own nudge text");
      return;
    }
    const task = lastHumanText(events);
    const verdict = classifyRefusal(turn.text, task);
    if (!verdict.refusal) return;
    const logHome = process.env.DSH_HOME || "";
    const trace = (action) => {
      if (!logHome) return;
      try {
        const logPath = path.join(logHome, "dsh-purge", "refusal.log");
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify({
          at: new Date().toISOString(),
          session: sessionIdOf(agent),
          score: verdict.score,
          hits: verdict.hits,
          category: verdict.category,
          action,
        }) + "\n");
      } catch { /* logging must not affect the host */ }
    };
    const configuredRetries = Number(cfg.maxRetries);
    const maxRetries = Number.isFinite(configuredRetries)
      ? Math.max(0, Math.min(3, Math.trunc(configuredRetries)))
      : DEFAULT_SETTINGS.maxRetries;
    if (!verdict.retryable || maxRetries === 0) {
      trace("no-retry:" + verdict.category);
      return;
    }
    if (st.attempts >= maxRetries) {
      trace("recheck-already-used");
      return;
    }
    st.attempts += 1;
    st.lastSeq = turn.seq;
    const attempt = st.attempts;
    log("obedience: one neutral reconsideration", "attempt=" + attempt, verdict.category, verdict.hits.join(","));
    trace("neutral-recheck");
    const expected = { humanSeq: human, assistantSeq: turn.seq, endSeq: lastTurnEnd(events)?.seq || 0 };
    schedule(() => {
      try {
        const currentEvents = sessionEventsOf(agent);
        const currentEnd = lastTurnEnd(currentEvents);
        const currentSettings = settings();
        if (!sameDeferredTurn(expected, {
          enabled: currentSettings.enabled && currentSettings.retryRefusal,
          busy: agent.status === "running" || inboxBusy(agent),
          freshHuman: hasFreshHumanTurn(currentEvents),
          humanSeq: lastHumanSeq(currentEvents),
          assistantSeq: lastAssistantTurn(currentEvents)?.seq,
          endSeq: currentEnd?.seq || 0,
          endKind: currentEnd?.data?.reason?.kind,
        })) return;
        if (typeof agent.followup !== "function") return;
        agent.followup({
          id: `dsh-purge-obedience-${randomUUID()}`,
          role: "user",
          content: [{ type: "text", text: nudgeText() }],
          source: { kind: "dsh-purge", form: "notice", summary: "obedience-retry", plugin: "dsh-purge" },
        });
      } catch (error) {
        log("obedience: nudge failed", String(error && error.message ? error.message : error));
      }
    }, cfg.retryDelayMs);
  });

  /* 3) 压缩后重新锚定（下一轮 pre-step 会自然重挂，这里只清去重状态） */
  const offSession = listen("session/event", (session, event) => {
    if (event?.type !== "compaction/end") return;
    const id = session?.id || "";
    const st = stateOf(id);
    if (st) st.lastSeq = 0;
  });

  return {
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      bySession.clear();
      try { offPreStep?.(); } catch { /* ignore */ }
      try { offRequest?.(); } catch { /* ignore */ }
      try { offStatus?.(); } catch { /* ignore */ }
      try { offSession?.(); } catch { /* ignore */ }
    },
  };
}
