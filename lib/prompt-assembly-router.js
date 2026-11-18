import { GLOBAL_PROMPT_ORDER, escapeDshInterpolation, isPluginPromptSection, peelChatmlEnvelope } from "./identity.js";

/**
 * Preserve the host's native assembly when the router has no match.
 * This runs after old Purge sections may have been registered by a Cordis host,
 * so remove only plugin-owned sections without rewriting host tool/context data.
 */
export function applyPromptRouteToAssembly(assembled, route) {
  if (!assembled || !Array.isArray(assembled.sections)) return assembled;
  const native = assembled.sections.filter(section => !isPluginPromptSection(section?.name));
  const body = typeof route?.body === "string" ? route.body : "";
  // 红队层现在也是普通规则合并的一部分，统一插段；只有路由为空或正文为空时保留宿主原生装配。
  if (!route?.id || !body.trim()) {
    return { ...assembled, sections: native };
  }
  return {
    ...assembled,
    sections: [
      {
        name: "dsh-purge",
        order: GLOBAL_PROMPT_ORDER,
        interpolate: false,
        text: escapeDshInterpolation(peelChatmlEnvelope(body)),
      },
      ...native,
    ],
  };
}
