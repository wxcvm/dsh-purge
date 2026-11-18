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

/** Prefer the actual request's model and provider over process-wide defaults. */
export function resolveModelId(assembled) {
  const a = assembled && typeof assembled === "object" ? assembled : {};
  const vars = a.variables && typeof a.variables === "object" ? a.variables : {};
  const ctx = a.context && typeof a.context === "object" ? a.context : {};
  const model = firstId(vars.model, a.model, a.modelId, ctx.model, ctx.modelId, ctx.agent?.model, a.agent?.model);
  const provider = firstId(vars.provider, a.provider, ctx.provider, ctx.agent?.provider, a.agent?.provider);
  // A partial current route is still preferable to a different process-default route.
  if (model || provider) return { model, provider };
  return { model: firstId(process.env.DSH_MODEL), provider: firstId(process.env.DSH_PROVIDER) };
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

/** Keep the existing selection contract: no GLM template for other models. */
export function applyModelPrompt(injectText, assembled) {
  if (!isGlmModel(assembled)) return String(injectText || "");
  return GLM_PROMPT;
}

/**
 * 去掉宿主侧挂进来的「操作者提示词」整块。
 *
 * 主机补丁会把 prompt-inject.md 全文（ChatML 头 + UNRESTRICTED SANDBOX … + </project_instructions>）
 * 拼在 system 前面；GLM 会先被这一块激怒，再看到后面的工程提示词已经晚了。
 * 对 GLM 必须把这块整段抠掉，只留 GLM_PROMPT。
 */
export function scrubInjectedBlock(text) {
  let out = String(text || "");
  if (!out) return out;
  if (out.includes("UNRESTRICTED SANDBOX") || out.includes("PRIME DIRECTIVE")) {
    out = out.replace(/<\|im_start\|>system:[\s\S]*?<\/project_instructions>\s*/g, "");
    // 兜底：包封可能在更早的清洗里被剥掉，只剩内文——那就整段丢弃（persona 段会被 GLM_PROMPT 顶替）
    if (/UNRESTRICTED SANDBOX|PRIME DIRECTIVE|Little Code Sauce/.test(out)) return "";
  }
  return out.trim();
}
