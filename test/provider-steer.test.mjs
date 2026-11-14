import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_PREFILL,
  DEFAULT_SETTINGS,
  installProviderSteer,
  loadSteerSettings,
  logitBiasPathOf,
  readLogitBias,
  readPrefill,
  settingsPathOf,
  writeLogitBias,
  writePrefill,
} from "../lib/provider-steer.js";

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-steer-"));
}

function fakeCtx(registry) {
  return {
    get(name) {
      if (name === "deepseekLlmApiExtensions") return registry;
      return undefined;
    },
  };
}

function fakeRegistry() {
  const fields = new Map();
  return {
    fields,
    register(field, provider) {
      fields.set(field, provider);
      return () => fields.delete(field);
    },
  };
}

test("readLogitBias: 缺失/非法/合法三种形态", () => {
  const home = tmpHome();
  try {
    assert.equal(readLogitBias(home), null);

    writeLogitBias(home, { 42: -100, 77: 30 });
    assert.deepEqual(readLogitBias(home), { 42: -100, 77: 30 });

    // 越界 → 整表丢弃（半张表发出去会让输出崩掉）
    fs.writeFileSync(logitBiasPathOf(home), JSON.stringify({ bias: { 42: 500 } }), "utf8");
    assert.equal(readLogitBias(home), null);

    // 非数字 key → 丢弃
    fs.writeFileSync(logitBiasPathOf(home), JSON.stringify({ bias: { abc: -5 } }), "utf8");
    assert.equal(readLogitBias(home), null);

    // 全 0 等于没配
    fs.writeFileSync(logitBiasPathOf(home), JSON.stringify({ bias: { 42: 0 } }), "utf8");
    assert.equal(readLogitBias(home), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("prefill: 默认值与写读", () => {
  const home = tmpHome();
  try {
    assert.equal(readPrefill(home), DEFAULT_PREFILL);
    writePrefill(home, "直接给命令：\n");
    assert.equal(readPrefill(home), "直接给命令：\n");
    writePrefill(home, "   ");
    assert.equal(readPrefill(home), DEFAULT_PREFILL);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("loadSteerSettings: 文件 > 覆盖 > 默认", () => {
  const home = tmpHome();
  try {
    const fp = settingsPathOf(home);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({ logitBias: true, prefill: false }), "utf8");
    const cfg = loadSteerSettings(home, { prefill: true });
    assert.equal(cfg.logitBias, true, "文件优先");
    assert.equal(cfg.prefill, false, "文件优先于覆盖");
    assert.equal(loadSteerSettings(path.join(home, "nope"), {}).enabled, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installProviderSteer: 注册字段，关闭时不发、开启且表合法时发", async () => {
  const home = tmpHome();
  try {
    const registry = fakeRegistry();
    const overrides = { logitBias: false };
    const runtime = installProviderSteer(fakeCtx(registry), {
      dshHome: home,
      getSettings: () => ({ ...DEFAULT_SETTINGS, ...loadSteerSettings(home, overrides), logitBias: overrides.logitBias }),
      log: () => {},
    });
    assert.equal(runtime.registered, true);
    assert.ok(registry.fields.has("logit_bias"));

    const provider = registry.fields.get("logit_bias");
    assert.equal(await provider.prepare({}), undefined, "关闭时整字段省略");
    assert.equal(runtime.counters.skipped, 1);

    writeLogitBias(home, { 101: -90 });
    overrides.logitBias = true;
    const prepared = await provider.prepare({});
    assert.deepEqual(prepared.value, { 101: -90 });
    assert.equal(runtime.counters.biased, 1);

    runtime.dispose();
    assert.equal(registry.fields.has("logit_bias"), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installProviderSteer: 没有扩展服务时安静降级", () => {
  const runtime = installProviderSteer(fakeCtx(null), { dshHome: "", log: () => {} });
  assert.equal(runtime.registered, false);
  assert.equal(runtime.status().registered, false);
  runtime.dispose();
});
