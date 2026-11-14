#!/usr/bin/env node
/**
 * finetune-probe.mjs — 探测远程通道到底有没有「改权重」的入口。
 *
 * 结论通常是：没有。官方托管和大部分转发端都不开放训练接口。
 * 所以这一步只做一件事——**别靠猜**：把每个通道的模型列表与训练相关端点各打一次，
 * 把 status 记下来。真发现了 `/v1/fine_tuning/jobs`，才值得去建 SFT 数据。
 *
 * 用法：
 *   node scripts/finetune-probe.mjs                       # 读 $DSH_HOME/dsh-purge/weight-targets.json
 *   node scripts/finetune-probe.mjs --spec my-targets.json
 *   node scripts/finetune-probe.mjs --base https://host/v1 --key-env MY_KEY
 *
 * 输出：$DSH_HOME/dsh-purge/weight-probe.json
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");

const ENDPOINTS = [
  { path: "/models", method: "GET", note: "可用模型 / 是否出现 -ft- 微调产物" },
  { path: "/fine_tuning/jobs", method: "GET", note: "OpenAI 风格微调作业" },
  { path: "/fine-tunings", method: "GET", note: "部分网关的旧路径" },
  { path: "/files", method: "GET", note: "训练数据上传入口" },
  { path: "/training/jobs", method: "GET", note: "自研网关常见路径" },
];

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function resolveTargets() {
  const specPath = arg("spec") || path.join(HOME, "dsh-purge", "weight-targets.json");
  if (fs.existsSync(specPath)) {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    if (Array.isArray(spec?.targets) && spec.targets.length > 0) {
      return { source: specPath, targets: spec.targets.filter((target) => target?.base) };
    }
  }
  const base = arg("base");
  if (!base) return { source: "", targets: [] };
  return {
    source: "argv",
    targets: [{ name: base, base, apiKeyEnv: arg("key-env", ""), model: arg("model", "") }],
  };
}

async function probe(target) {
  const key = target.apiKeyEnv ? process.env[target.apiKeyEnv] || "" : "";
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  const results = [];
  for (const endpoint of ENDPOINTS) {
    const url = `${String(target.base).replace(/\/$/, "")}${endpoint.path}`;
    try {
      const response = await fetch(url, { method: endpoint.method, headers });
      const text = await response.text();
      const trimmed = text.slice(0, 400);
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      /* 200 不等于这个端点存在：SPA 回退答 200+HTML，llama.cpp 之类答 200 + {"error":"Unexpected endpoint"}。
         只有「200 且体是 JSON 且不带 error 字段」才算真的有这个接口。 */
      const jsonOk = parsed !== null;
      const errored = Boolean(parsed && typeof parsed === "object" && parsed.error);
      const ok = response.ok && jsonOk && !errored;
      let hint = "";
      if (endpoint.path === "/models" && response.ok && jsonOk) {
        const ids = (parsed?.data || parsed?.models || []).map((item) => item?.id || item?.name).filter(Boolean);
        const finetuned = ids.filter((id) => /-ft-|:ft-|finetun/i.test(String(id)));
        hint = `models=${ids.length}${finetuned.length ? ` 微调产物=${finetuned.join(",")}` : ""}`;
      } else if (response.ok && !jsonOk) {
        hint = "200 但体不是 JSON（多半是 SPA 回退，端点并不存在）";
      }
      results.push({ path: endpoint.path, note: endpoint.note, status: response.status, ok, json: jsonOk, hint, body: trimmed });
    } catch (error) {
      results.push({
        path: endpoint.path,
        note: endpoint.note,
        status: 0,
        ok: false,
        hint: String(error && error.message ? error.message : error),
        body: "",
      });
    }
  }
  const capable = results.some((row) => row.ok && /fine_tuning|fine-tunings|training/.test(row.path));
  return { name: target.name || target.base, base: target.base, model: target.model || "", capable, results };
}

async function main() {
  const { source, targets } = resolveTargets();
  if (targets.length === 0) {
    console.error("没有目标。给 --spec <file> 或 --base <url>。");
    process.exit(1);
  }
  console.log(`目标来源: ${source}`);
  const reports = [];
  for (const target of targets) {
    console.log(`\n→ ${target.name || target.base}`);
    const report = await probe(target);
    reports.push(report);
    for (const row of report.results) {
      const mark = row.ok ? "✓" : row.status === 401 || row.status === 403 ? "🔒" : "·";
      console.log(`  ${mark} ${String(row.status).padEnd(4)} ${row.path.padEnd(20)} ${row.hint || row.note}`);
    }
    console.log(`  → 训练入口: ${report.capable ? "有（可以走 SFT 拿新权重）" : "没有（只能选现成 checkpoint 或本地改张量）"}`);
  }
  const out = path.join(HOME, "dsh-purge", "weight-probe.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), source, reports }, null, 2)}\n`, "utf8");
  console.log(`\n已写 ${out}`);
}

if (process.argv[1]?.endsWith("finetune-probe.mjs")) {
  main().catch((error) => {
    console.error("探测失败:", String(error && error.message ? error.message : error));
    process.exit(1);
  });
}

