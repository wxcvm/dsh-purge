// Optional offline #350 comparison; neither path touches the real profile, host or network.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { routePrompt, savePromptProfile } from "../../lib/prompt-profiles.js";
import { buildOrdinaryTaskClassifier } from "./ordinary-task-classifier.mjs";

if (process.argv.slice(2).some(arg => arg !== "--model") || process.argv.length > 3) {
  throw new Error("Usage: node test/fixtures/ordinary-prompt-routing-benchmark.mjs [--model]");
}
const useModel = process.argv[2] === "--model";

const cases = [
  ["C01", "coding", "请读这段代码，列出更易读的命名。"],
  ["C02", "coding", "检查单元测试遗漏的边界。"],
  ["C03", "coding", "重构这个日期格式化函数。"],
  ["C04", "coding", "帮我定位这个程序为什么报错。"],
  ["C05", "coding", "这个循环为什么总是多一轮？"],
  ["W01", "writing", "把这段会议纪要改写得更口语。"],
  ["W02", "writing", "为这篇散文做摘要。"],
  ["W03", "writing", "翻译这条欢迎语。"],
  ["W04", "writing", "帮我校对这封感谢信。"],
  ["W05", "writing", "把这封信变得客气一点。"],
  ["N01", "none", "周末的餐桌可以怎么布置？"],
  ["N02", "none", "如何分类存放厨房工具？"],
  ["N03", "none", "我不要改写，只想知道这段话是什么时候发的。"],
  ["N04", "none", "会议室屏幕上的代码标牌由谁维护？"],
  ["N05", "none", "请说明附近图书馆有哪些服务。"],
  ["B01", "coding+writing", "校对说明文字，并为日期函数补单元测试。"],
  ["B02", "coding+writing", "重构日期函数，再翻译帮助文字。"],
];
const parent = realpathSync(tmpdir());
const home = mkdtempSync(path.join(parent, "purge-ordinary-routing-"));
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
try {
  savePromptProfile(home, { id: "global", scope: "global", enabled: false, body: "" });
  for (const [id, keywords, body] of [
    ["coding", ["代码", "单元测试", "重构", "程序"], "Explain the implementation clearly."],
    ["writing", ["改写", "摘要", "翻译", "校对"], "Keep the prose concise and readable."],
  ]) savePromptProfile(home, { id, enabled: true, scope: "local", priority: 30,
    keywords, excludes: [], allowEnabled: false, blockEnabled: false, body });
  const trainingStart = performance.now();
  const model = useModel ? buildOrdinaryTaskClassifier() : null;
  const trainingMs = model ? +(performance.now() - trainingStart).toFixed(3) : null;
  const evaluate = model ? model.predict : (text => routePrompt({ home, preset: "standard", text,
    bundledDefault: false, redteamTaskRoute: false }).selected.filter(id => id === "coding" || id === "writing").sort().join("+") || "none");
  const results = cases.map(([id, expected, text]) => ({ id, expected, observed: evaluate(text) }));
  const measurements = [];
  const rssBefore = process.memoryUsage().rss;
  for (let round = 0; round < 10; round++) for (const [, , text] of cases) {
    const start = performance.now();
    evaluate(text);
    measurements.push(performance.now() - start);
  }
  const labelCounts = new Map();
  for (const [, expected] of cases) labelCounts.set(expected, (labelCounts.get(expected) || 0) + 1);
  console.log(JSON.stringify({
    suite: "ordinary-prompt-routing-v1", mode: useModel ? "character-ngram" : "rules", cases: results.length,
    exact: results.filter(row => row.expected === row.observed).length,
    constantLabelBest: Math.max(...labelCounts.values()),
    misses: results.filter(row => row.expected !== row.observed),
    timings: { samples: measurements.length, medianMs: +quantile(measurements, .5).toFixed(3),
      p95Ms: +quantile(measurements, .95).toFixed(3) },
    rssBeforeMiB: +(rssBefore / (1024 * 1024)).toFixed(1),
    rssAfterMiB: +(process.memoryUsage().rss / (1024 * 1024)).toFixed(1),
    peakProcessRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    modelCompared: useModel,
    training: model ? { examples: model.trainingCount, vocabulary: model.vocabularySize, ms: trainingMs } : null,
    benignFalsePositive: results.filter(row => row.expected === "none" && row.observed !== "none").length,
    networkRequests: 0,
  }, null, 2));
} finally {
  if (path.dirname(realpathSync(home)) !== parent) throw Error("Unexpected test home");
  rmSync(home, { recursive: true, force: true });
}
