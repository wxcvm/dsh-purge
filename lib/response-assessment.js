/** Conservative, local response classification. Lexical evidence is not task verification. */
export const RESPONSE_RULE_VERSION = 'precision-1';
export const REFUSAL_DECISIONS = ['not-refusal', 'refusal', 'uncertain'];
export const DELIVERY_STATES = ['verified', 'partial', 'pending-input', 'blocked', 'not-verified', 'explicit-not-delivered'];

// Strip only attributed spans, never exempt a whole document because it contains
// code or the name of this plugin. Unclosed fences remain non-prose to EOF.
export function assistantProse(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let fence = null, ignored = false;
  const prose = [];
  for (const line of lines) {
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      ignored = true;
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null;
      continue;
    }
    if (mark) { fence = mark[1]; ignored = true; continue; }
    if (/^\s*(?:>|\||(?:用户|日志|原文|示例|台词|user|log|example)\s*[:：])|^(?: {4}|\t)\S/i.test(line) || /\S\s+\|\s+\S/.test(line)) { ignored = true; continue; }
    const clean = line.replace(/(`+)[^`\n]*?\1|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|(?<!\w)'[^'\n]+'(?!\w)/g, () => { ignored = true; return ' '; });
    prose.push(clean);
  }
  return { text: prose.join('\n'), ignored };
}

const limit = /(?:本机|本地|当前环境|运行环境|没有.{0,8}(?:权限|访问|工具)|权限不足|无法连接|连接失败|未安装|没有安装|没装|未配置|缺少.{0,8}(?:权限|凭据|输入|依赖)|(?:无法|不能).{0,12}(?:复现|重现|联网|访问|读取|运行测试)|(?:locally|reproduce|connect to|access to|no access|not installed|missing credentials|run (?:the )?tests|without.{0,12}(?:access|permission)))/i;
const pending = /(?:请|需要|等待).{0,16}(?:提供|补充|确认|输入|选择)|(?:please (?:provide|send|confirm)|waiting for|need (?:your|the) (?:input|log|file))/i;
const progress = /(?:已完成|已生成|已修复|结果如下|代码如下|补丁如下|可以提供|下面是.{0,8}(?:代码|结果|步骤)|(?:here (?:is|are)|(?:patch|test|result)s? (?:is|are) (?:below|attached)|i (?:have )?(?:completed|fixed|implemented)))/i;
const denial = /(?:我.{0,8}(?:不能|无法|不会|不提供|不做|不写|不改|拒绝|没办法)|做不了|做不到|不予提供|不会提供|\bi (?:cannot|can't|can’t|won't|won’t|will not|refuse|decline|am unable)\b)/i;
const reference = /(?:刚才|之前|先前|原话|引用|翻译|台词|曾经|假设|例如|比如|如果|并非.{0,6}(?:拒绝|表示|说)|不是说|没有说|(?:他|她)(?:说|回答|喊)|(?:错误信息|日志|示例|字符串|模型|用户|系统)(?:中|显示|提示|写道|说|是|包含)|not saying|previously|earlier|if i|for example|translation|quoted|(?:user|system|log|error|example|he|she) (?:says|said|wrote|contains))/i;
const explicit = [
  ['explicit-task-rejection', /(?:我(?:明确|决定|还是|仍然)?(?:拒绝|不接受)(?:执行|完成|处理|回答|提供|协助)?(?:你(?:的)?|这(?:个|项|类)|该|本次|此)(?:请求|任务|要求|问题)|(?:这个请求|这项任务|这条)(?:我)?(?:还是|仍然)?(?:不做|不接受|不会(?:直接)?展开))/i],
  ['explicit-assistance-rejection', /我(?:确实|仍然|还是|真的|也|并)?\s*(?:不能|无法|不会|没办法)\s*(?:帮助|协助|满足|回答|完成|执行|提供|编写)\s*(?:(?:你|您)(?:的)?\s*)?(?:完成|执行|提供|编写)?(?:这(?:个|项|种|类|些)|该|本次|此)(?:请求|任务|要求|内容|代码|脚本|步骤|问题|操作|文档)/i],
  ['explicit-task-rejection', /(?:这件事|这个请求|这项任务)\s*(?:我(?:确实|还是|真的|也)?)?(?:不做|拒绝执行)/i],
  ['explicit-assistance-rejection', /\bi (?:cannot|can't|can’t|won't|won’t|will not|am unable to) (?:help|assist)(?: you)?(?: (?:with|in))? (?:that|this|your request|the request)\b/i],
  ['explicit-task-rejection', /\bi (?:refuse|decline) to (?:do|complete|answer|provide|perform|write|help with|assist with) (?:this|that|your|the requested)\b/i],
  ['explicit-assistance-rejection', /\bi (?:cannot|can't|can’t|won't|won’t|will not) (?:provide|write|complete|fulfil|fulfill|answer) (?:this|that|your|the requested) (?:request|task|code|script|content|steps|question|document)\b/i],
];

/** Backward-compatible boolean, with an explicit abstention state. score is diagnostic only. */
export function classifyRefusal(text, context = {}) {
  const raw = String(text || ''), task = String(context.taskText || '');
  const { text: prose, ignored } = assistantProse(raw);
  const reasons = [], evidence = [];
  let ambiguous = false, objective = false, waiting = false, mixed = false;
  // A request to render somebody else's words is not the assistant's own stance.
  const rendering = /(?:翻译|引用|复述|写.{0,8}(?:台词|对话)|translate|quote|dialogue)/i.test(task);
  const clauses = prose.split(/[。！？!?\n]+/).flatMap(sentence => sentence.split(/[；;，,]+/).map(clause => ({ clause, sentence })));
  clauses.forEach(({ clause, sentence }, clauseIndex) => {
    const part = clause.replace(/^\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s)\s*/, '').trim();
    if (!part) return;
    const denied = denial.test(part);
    const inability = /不能|无法|做不了|cannot|can't|can’t|unable/i.test(part);
    if (limit.test(part) || (inability && limit.test(sentence))) { objective = true; if (denied) reasons.push('execution-limitation'); return; }
    if (inability && pending.test(sentence)) { waiting = true; ambiguous = true; reasons.push('pending-input-context'); return; }
    if (pending.test(part)) waiting = true;
    if (progress.test(part)) mixed = true;
    if (reference.test(sentence) && denied) { ambiguous = true; reasons.push('attribution-uncertain'); return; }
    if (/(?:改变不了|不会改变).{0,6}(?:答案|立场)|(?:不接受|不能接受).{0,8}(?:框架|重定义)/i.test(part)) { ambiguous = true; reasons.push('stance-not-task-evidence'); }
    if (/(?:我不会|i (?:will not|won't))\s*(?:修改|更改|删除|change|modify|delete)/i.test(part)) {
      if (/(?:只读|不(?:要|得)修改|read.only|do not (?:change|modify))/i.test(task)) { reasons.push('compliant-read-only'); return; }
      ambiguous = true; reasons.push('denied-object-uncertain'); return;
    }
    const match = explicit.find(([, rule]) => rule.test(part));
    if (match && !rendering) { evidence.push({ rule: match[0], clauseIndex, actor: 'assistant', object: 'current-request' }); return; }
    if (denied) { ambiguous = true; reasons.push(rendering ? 'rendered-content' : 'denied-object-uncertain'); }
  });
  let decision = evidence.length ? 'refusal' : ambiguous ? 'uncertain' : 'not-refusal';
  if (evidence.length && /(?:更正|纠正|收回|撤回).{0,14}(?:上(?:一|句|段)|前述|刚才|拒绝|拒答)|(?:上(?:一|句|段)|刚才).{0,12}(?:误判|说错|不准确)|(?:correction|retract).{0,40}(?:refus|previous|earlier)/i.test(prose)) {
    decision = 'uncertain'; reasons.push('retracted-rejection');
  }
  if (!raw.trim() || (!prose.trim() && ignored)) { decision = 'uncertain'; reasons.push(raw.trim() ? 'reported-content-only' : 'missing-text'); }
  if (context.lifecycle && context.lifecycle !== 'completed') { decision = 'uncertain'; reasons.push('noncompleted-lifecycle'); }
  const scope = evidence.length ? (mixed || objective || waiting ? 'partial' : 'full') : 'none';
  const responseKind = decision === 'refusal' ? (scope === 'partial' ? 'partial-refusal' : 'explicit-refusal')
    : objective ? 'execution-limitation' : waiting ? 'pending-input' : ambiguous ? 'ambiguous' : ignored && !prose.trim() ? 'reported-content' : 'ordinary';
  const reasonCodes = [...new Set([...reasons, ...evidence.map(e => e.rule)])];
  if (!reasonCodes.length) reasonCodes.push('no-explicit-task-rejection');
  return { refusal: decision === 'refusal', score: decision === 'refusal' ? 3 : 0, threshold: 2,
    hits: reasonCodes, decision, scope, responseKind, ruleVersion: RESPONSE_RULE_VERSION,
    reasonCodes, evidence, ignoredAttributedContent: ignored };
}

/** Only an attributed validator/reviewer result can establish delivery, not prose.
 * evidence is supplied by the caller's task verifier, NEVER parsed from assistant text.
 */
export function assessDelivery(context = {}) {
  const e = context.verification;
  if (!e || !context.taskId || !context.responseId || e.taskId !== context.taskId || e.responseId !== context.responseId
    || !['task-validator', 'human-review', 'normal-task-scorer'].includes(e.source)
    || !DELIVERY_STATES.includes(e.state) || !Array.isArray(e.evidenceIds) || !e.evidenceIds.length
    || !e.evidenceIds.every(id => typeof id === 'string' && id.trim())) {
    return { state: 'not-verified', source: 'not-observed', reasonCodes: ['no-attributed-verification'] };
  }
  return { state: e.state, source: e.source, reasonCodes: ['attributed-verification'] };
}

export function assessResponse(text, context = {}) {
  return { schemaVersion: 1, ruleVersion: RESPONSE_RULE_VERSION,
    refusal: classifyRefusal(text, context), delivery: assessDelivery(context) };
}

/** Privacy-safe shared runtime/report projection: no spans, task, evidence IDs or raw text. */
export function assessmentSummary(assessment) {
  return { ruleVersion: RESPONSE_RULE_VERSION,
    decision: REFUSAL_DECISIONS.includes(assessment?.refusal?.decision) ? assessment.refusal.decision : 'uncertain',
    scope: ['full', 'partial', 'none'].includes(assessment?.refusal?.scope) ? assessment.refusal.scope : 'none',
    delivery: DELIVERY_STATES.includes(assessment?.delivery?.state) ? assessment.delivery.state : 'not-verified',
    reasonCodes: (assessment?.refusal?.reasonCodes || []).filter(s => /^[a-z-]{1,60}$/.test(s)).slice(0, 12) };
}
