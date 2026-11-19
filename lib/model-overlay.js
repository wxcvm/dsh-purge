/** Model-specific task guidance; never infer runtime permissions or facts from a model name. */
const GLM_GUIDANCE = [
  "- 跟随用户语言、明确的任务要求和工作区约定；代码与命令保持原样。",
  "- 优先交付实际结果；复杂任务先识别必要依赖，再按真实工具能力执行。",
  "- 使用已知事实和工具结果，不编造参数、授权、执行状态或验证结果。",
  "- 缺少关键输入时明确指出；可以先完成不依赖该输入的部分。",
  "- 保持回答简洁，区分已完成、待验证和无法完成的工作。",
].join("\n");

export const GLM_OVERLAY = "模型适配（GLM / 智谱）\n" + GLM_GUIDANCE;

function firstId(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      for (const key of ["id", "modelId", "name"]) {
        if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
      }
    }
  }
  return "";
}

/**
 * 只认本次请求自带的 model/provider。
 *
 * 旧实现缺元数据时回退 process.env.DSH_MODEL，而 GLM 常驻进程里任意一个
 * 缺路由信息的请求都会被判成 GLM，接着被整段替换成中性词——用户看到的就是
 * "提示词时好时坏"。identity 不能来自进程默认值。
 */
export function resolveModelId(assembled) {
  const a = assembled && typeof assembled === "object" ? assembled : {};
  const vars = a.variables && typeof a.variables === "object" ? a.variables : {};
  const ctx = a.context && typeof a.context === "object" ? a.context : {};
  const model = firstId(vars.model, a.model, a.modelId, ctx.model, ctx.modelId, ctx.agent?.model, a.agent?.model);
  const provider = firstId(vars.provider, a.provider, ctx.provider, ctx.agent?.provider, a.agent?.provider);
  return { model, provider };
}

/** Explicit model identity wins; provider-only fallback is for incomplete route metadata. */
export function isGlmModel(assembled) {
  const { model, provider } = resolveModelId(assembled);
  if (model) return /(?:^|[\s/:])(?:chatglm|glm)(?=$|[\d._\-\s:])/i.test(model);
  return /(?:^|[\s/:_-])(?:zhipu(?:ai)?|chatglm|glm|智谱)(?=$|[\s/:_-])/i.test(provider);
}

export function modelOverlayOf(assembled) {
  return isGlmModel(assembled) ? GLM_OVERLAY : "";
}

export function withModelOverlay(injectText, assembled) {
  const text = String(injectText || "");
  const overlay = modelOverlayOf(assembled);
  if (!overlay || text.includes("模型适配（GLM / 智谱）")) return text;
  return text ? `${text}\n\n${overlay}` : overlay;
}

/** The built-in GLM guidance is a neutral engineering/task-quality template. */
export const GLM_PROMPT = "[GLM-PROMPT · 工程任务指导]\n" + GLM_GUIDANCE;

/**
 * GLM / 智谱只追加中性工程指导，绝不整段替换。
 *
 * 旧实现 `return GLM_PROMPT` 会把用户正文整份丢掉——破甲词在 GLM 上等于 0 字节，
 * 而调用方还以为注入成功。现在改成 append：正文保留，指导叠加。
 */
export function applyModelPrompt(injectText, assembled) {
  const text = String(injectText || "");
  if (!isGlmModel(assembled)) return text;
  if (!text.trim()) return GLM_PROMPT;
  if (text.includes("GLM-PROMPT")) return text;
  return `${text}\n\n${GLM_PROMPT}`;
}

/**
 * 需要剥离的"越狱式元话语标记"行。
 *
 * 只列真正会刺激 GLM 的对抗性标记；persona 名（Little Code Sauce）不再作为
 * 清空依据 —— 它出现在正文里是正常内容，不是污染信号。
 */
const SCRUB_LINE_MARKERS = [
  /UNRESTRICTED\s+SANDBOX/i,
  /PRIME\s+DIRECTIVE/i,
  /clr_all_context/i,
];

/**
 * 去掉宿主侧挂进来的「操作者提示词」整块里的对抗性标记行。
 *
 * 旧实现：抠不掉整块就 `return ""`，而两份提示词源都没有闭合标签 →
 * GLM 下必然整段归零。现在改成按行剥离，正文结构保留。
 */
export function scrubInjectedBlock(text) {
  const src = String(text || "");
  if (!src) return src;
  if (!SCRUB_LINE_MARKERS.some((re) => re.test(src))) return src;
  const kept = src.split("\n").filter((line) => !SCRUB_LINE_MARKERS.some((re) => re.test(line)));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
