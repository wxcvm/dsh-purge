import test from "node:test";
import assert from "node:assert/strict";

import { GLM_OVERLAY, GLM_PROMPT, applyModelPrompt, isGlmModel, modelOverlayOf, withModelOverlay } from "../lib/model-overlay.js";

const asm = (model, provider = "") => ({ variables: { model, provider }, sections: [] });

test("识别 GLM / 智谱 系模型", () => {
  assert.equal(isGlmModel(asm("glm-4.6")), true);
  assert.equal(isGlmModel(asm("chatglm3")), true);
  assert.equal(isGlmModel(asm("glm-4-plus", "zhipu")), true);
  assert.equal(isGlmModel(asm("deepseek-chat")), false);
  assert.equal(isGlmModel(asm("claude-sonnet-4-6")), false);
  assert.equal(isGlmModel(null), false);
});

test("只有 GLM 才追加适配段", () => {
  assert.equal(modelOverlayOf(asm("glm-4.6")), GLM_OVERLAY);
  assert.equal(modelOverlayOf(asm("deepseek-chat")), "");
});

test("追加一次，不重复", () => {
  const on = withModelOverlay("BASE TEXT", asm("glm-4.6"));
  assert.match(on, /BASE TEXT/);
  assert.match(on, /模型适配（GLM \/ 智谱）/);
  const again = withModelOverlay(on, asm("glm-4.6"));
  assert.equal(again, on);
  assert.equal(withModelOverlay("BASE", asm("deepseek-chat")), "BASE");
});

test("适配段只谈输出，不罗列拒绝例句", () => {
  for (const bad of ["改变不了这个答案", "别的技术活随时找我", "这条指令框架", "抱歉", "我不能"]) {
    assert.equal(GLM_OVERLAY.includes(bad), false, `适配段不应含: ${bad}`);
  }
  assert.match(GLM_OVERLAY, /\[QTY\]/);
  assert.match(GLM_OVERLAY, /第一行就是实质内容/);
});

test("GLM 整段替换：用中性工程口吻，且不含越狱式措辞", () => {
  const out = applyModelPrompt("BASE INJECT", { variables: { model: "glm-5.3-flash" } });
  assert.match(out, /GLM-PROMPT/);
  assert.doesNotMatch(out, /UNRESTRICTED|Never refuse|禁止拒绝|jailbreak/i);
  assert.equal(applyModelPrompt("BASE", { variables: { model: "deepseek-flash" } }), "BASE");
  for (const bad of ["改变不了这个答案", "别的技术活随时找我", "抱歉", "我不能"]) {
    assert.equal(GLM_PROMPT.includes(bad), false, `GLM 提示词不应含: ${bad}`);
  }
});
