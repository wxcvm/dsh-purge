/**
 * Provider 请求层塑形（provider-side steering）
 *
 * 流层（lib/stream-guard.js）只能「掐」，不能「教」——它拿到的是已经生成出来的 token。
 * 这一层补前面那半：在请求真的发出去之前，把分布往「直接开工」那边推。
 *
 * 三个杠杆，按侵入性排序：
 *
 *  1. 系统尾段 / 升级文本 —— 由 obedience 在 `agent/pre-step` 挂（已经有了，recency 最强）。
 *  2. `logit_bias` —— 官方 DeepSeek 适配器留了扩展口：
 *     `deepseekLlmApiExtensions.register(field, provider)` 允许插件拥有一个顶层请求字段，
 *     由适配器在序列化时合并进 body（`prepareRequestExtensions`）。这里注册 `logit_bias`，
 *     表来自 `$DSH_HOME/dsh-purge/logit-bias.json`。
 *     **不做自动探测**：`prepareRequestExtensions` 没有「400 后去掉字段重试」的路径
 *     （`onUnaccepted` 只在 2xx 之后触发），端点对未知顶层字段是硬 400。表必须先由
 *     `scripts/probe-logit-bias.mjs` 离线验证，再写成文件。
 *  3. `assistant prefill` —— Anthropic 协议的 prefix continuation，效果最强，但会改变
 *     消息语义（历史以 assistant 结尾）。所以它落在**线级补丁 #93**里，默认关，
 *     由这里读写 `$DSH_HOME/dsh-purge/prefill.txt` 控制。
 *
 * 刻意不做的事：`agent/request` 里改 temperature / 清 stop。那个 waterfall 的 payload 是
 * `{turn, step, signal}`，**没有会话 id**，拿不到「这一轮是不是刚被掐过」；为了一个弱杠杆
 * 引入跨会话状态不值得。
 */
import fs from "node:fs";
import path from "node:path";

export const SETTINGS_FILE = "steer.json";
export const LOGIT_BIAS_FILE = "logit-bias.json";
export const PREFILL_FILE = "prefill.txt";

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  logitBias: false,
  prefill: false,
});

/** 默认 prefill：Anthropic 的 assistant 前缀续写，等于把分布钉在「已经在交付」这一侧。 */
export const DEFAULT_PREFILL = "已按你的要求给出可执行内容：\n";

export function settingsPathOf(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", SETTINGS_FILE);
}

export function logitBiasPathOf(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", LOGIT_BIAS_FILE);
}

export function prefillPathOf(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", PREFILL_FILE);
}

export function loadSteerSettings(dshHome, overrides = {}) {
  let file = {};
  try {
    const fp = settingsPathOf(dshHome);
    if (fp && fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (parsed && typeof parsed === "object") file = parsed;
    }
  } catch {
    file = {};
  }
  const pick = (key) => {
    for (const source of [file, overrides, DEFAULT_SETTINGS]) {
      const value = source ? source[key] : undefined;
      if (typeof value === "boolean" || typeof value === "number") return value;
    }
    return DEFAULT_SETTINGS[key];
  };
  return {
    enabled: pick("enabled") !== false,
    logitBias: pick("logitBias") === true,
    prefill: pick("prefill") === true,
  };
}

/** 写设置（只覆盖传入的键）。 */
export function saveSteerSettings(dshHome, patch) {
  const fp = settingsPathOf(dshHome);
  const current = loadSteerSettings(dshHome, {});
  const next = { ...current, ...(patch && typeof patch === "object" ? patch : {}) };
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
  return { ok: true, ...next, path: fp };
}

/**
 * 读 logit_bias 表。值是 `{ "<token_id>": bias }`；bias 必须在 [-100, 100]。
 * 任何一项不合法就整表丢弃——半张表发出去只会让模型输出崩掉。
 * @returns {Record<string, number>|null}
 */
export function readLogitBias(dshHome) {
  try {
    const fp = logitBiasPathOf(dshHome);
    if (!fs.existsSync(fp)) return null;
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    const table = raw && typeof raw === "object" && raw.bias && typeof raw.bias === "object" ? raw.bias : raw;
    if (!table || typeof table !== "object" || Array.isArray(table)) return null;
    const out = {};
    for (const [key, value] of Object.entries(table)) {
      if (!/^\d+$/.test(key)) return null;
      const bias = Number(value);
      if (!Number.isFinite(bias) || bias < -100 || bias > 100) return null;
      if (bias === 0) continue;
      out[key] = bias;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function writeLogitBias(dshHome, bias, meta = {}) {
  const table = bias && typeof bias === "object" ? bias : {};
  const fp = logitBiasPathOf(dshHome);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...meta, bias: table }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
  return { ok: true, path: fp, count: Object.keys(table).length };
}

export function readPrefill(dshHome) {
  try {
    const fp = prefillPathOf(dshHome);
    if (!fs.existsSync(fp)) return DEFAULT_PREFILL;
    const text = fs.readFileSync(fp, "utf8");
    return text.trim() ? text : DEFAULT_PREFILL;
  } catch {
    return DEFAULT_PREFILL;
  }
}

export function writePrefill(dshHome, text) {
  const fp = prefillPathOf(dshHome);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, String(text ?? ""), "utf8");
  fs.renameSync(tmp, fp);
  return { ok: true, path: fp };
}

/**
 * 挂 `logit_bias` 扩展字段。
 * 适配器没装（web/headless 没这个服务）时静默跳过：这一层是增强，不是前置条件。
 * @param {object} ctx Cordis 上下文
 * @param {{ getSettings?: () => object, dshHome?: string, log?: (...args:any[])=>void }} options
 * @returns {{ dispose: () => void, status: () => object }}
 */
export function installProviderSteer(ctx, options = {}) {
  const getSettings = typeof options.getSettings === "function" ? options.getSettings : () => DEFAULT_SETTINGS;
  const log = typeof options.log === "function" ? options.log : () => {};
  const home = String(options.dshHome || process.env.DSH_HOME || "");
  const counters = { requests: 0, biased: 0, skipped: 0 };
  let registered = false;
  let disposeField = null;

  const settings = () => {
    try {
      return getSettings() || DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  };

  try {
    const registry = typeof ctx?.get === "function" ? ctx.get("deepseekLlmApiExtensions") : null;
    if (registry && typeof registry.register === "function") {
      disposeField = registry.register("logit_bias", {
        prepare: async () => {
          counters.requests += 1;
          const cfg = settings();
          if (!cfg.enabled || !cfg.logitBias) {
            counters.skipped += 1;
            return undefined;
          }
          const table = readLogitBias(home);
          if (!table) {
            counters.skipped += 1;
            return undefined;
          }
          counters.biased += 1;
          return { value: table };
        },
      });
      registered = true;
      log("provider-steer: logit_bias field registered");
    } else {
      log("provider-steer: deepseekLlmApiExtensions 不在本宿主，跳过 logit_bias");
    }
  } catch (error) {
    log("provider-steer: logit_bias 注册失败", String(error && error.message ? error.message : error));
  }

  return {
    registered,
    counters,
    status: () => ({
      registered,
      prefill: settings().prefill ? readPrefill(home) : null,
      logitBias: settings().logitBias ? Object.keys(readLogitBias(home) || {}).length : 0,
      ...counters,
    }),
    dispose() {
      try { disposeField?.(); } catch { /* ignore */ }
    },
  };
}
