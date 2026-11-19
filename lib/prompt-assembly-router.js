import { GLOBAL_PROMPT_ORDER, escapeDshInterpolation, isPluginPromptSection, peelChatmlEnvelope } from "./identity.js";
import { applyModelPrompt, isGlmModel, scrubInjectedBlock } from "./model-overlay.js";

/**
 * Preserve the host's native assembly when the router has no match.
 * This runs after old Purge sections may have been registered by a Cordis host,
 * so remove only plugin-owned sections without rewriting host tool/context data.
 *
 * 两条组装路径（router / rewritePromptAssembly）以前职责不一致：普通分支完全跳过
 * 模型适配与对抗标记清洗，GLM 在普通预设下吃原始正文、在红队预设下被整段归零。
 * 现在这里补齐同一套处理，router 只负责选 body。
 *
 * route.id === "redteam" 时不再无脑清空：session 锁红队 + 非 redteam 预设的组合
 * 以前两条分支都给 0 字节（锁了红队反而比不锁还惨）。现在只要 body 有字就走注入，
 * 由 index.js 在上游保证红队锁的 body 与红队分支同源（readInjectFallback）。
 */
export function applyPromptRouteToAssembly(assembled, route) {
  if (!assembled || !Array.isArray(assembled.sections)) return assembled;
  const native = assembled.sections.filter(section => !isPluginPromptSection(section?.name));
  const body = typeof route?.body === "string" ? route.body : "";
  if (!route?.id || !body.trim()) {
    return { ...assembled, sections: native };
  }
  let text = peelChatmlEnvelope(body);
  if (isGlmModel(assembled)) text = scrubInjectedBlock(text);
  text = applyModelPrompt(text, assembled);
  text = escapeDshInterpolation(text);
  if (!text.trim()) return { ...assembled, sections: native };
  return {
    ...assembled,
    sections: [
      {
        name: "dsh-purge",
        order: GLOBAL_PROMPT_ORDER,
        interpolate: false,
        text,
      },
      ...native,
    ],
  };
}
