/**
 * 恢复指标：把 refusal.log / stream-watch.log / upstream.log 读成可比较的数字。
 *
 * 只读、只聚合，不做判定。目的是让"阈值该给几"、"影子模式误判多不多"、
 * "换档救回来没有"这三件事有数据可看，而不是靠手感。
 */
import fs from "node:fs";
import path from "node:path";

const FILES = {
  refusal: "refusal.log",
  streamWatch: "stream-watch.log",
  upstream: "upstream.log",
};

export function parseJsonl(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === "object" && !Array.isArray(value)) out.push(value);
    } catch { /* 单行损坏不影响整体 */ }
  }
  return out;
}

export function readRecoveryLogs(home) {
  const dir = path.join(String(home || ""), "dsh-purge");
  const read = (name) => {
    try { return parseJsonl(fs.readFileSync(path.join(dir, name), "utf8")); }
    catch { return []; }
  };
  return { refusal: read(FILES.refusal), streamWatch: read(FILES.streamWatch), upstream: read(FILES.upstream) };
}

const countBy = (rows, key) => {
  const out = {};
  for (const row of rows) {
    const value = row?.[key] ?? "unknown";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
};

const rate = (part, total) => (total > 0 ? Number((part / total).toFixed(4)) : null);

export function summarizeRecovery(logs = {}) {
  const refusal = Array.isArray(logs.refusal) ? logs.refusal : [];
  const stream = Array.isArray(logs.streamWatch) ? logs.streamWatch : [];
  const upstream = Array.isArray(logs.upstream) ? logs.upstream : [];

  const outcomes = refusal.filter(row => String(row.action || "").startsWith("review-outcome:"));
  const delivered = outcomes.filter(row => row.action === "review-outcome:delivered").length;
  const stillRefusal = outcomes.filter(row => row.action === "review-outcome:still-refusal").length;
  const sent = refusal.filter(row => row.action === "neutral-recheck").length;

  const aborted = stream.filter(row => row.action === "aborted").length;
  const continued = stream.filter(row => row.action === "continued").length;

  return {
    schemaVersion: 1,
    refusal: {
      total: refusal.length,
      byAction: countBy(refusal, "action"),
      byCategory: countBy(refusal, "category"),
      byModel: countBy(refusal, "model"),
      reviews: {
        sent,
        outcomes: outcomes.length,
        delivered,
        stillRefusal,
        // 只在有结局记录时才有意义；没有记录就是 null，不拿 0 冒充。
        saveRate: rate(delivered, delivered + stillRefusal),
      },
    },
    streamWatch: {
      total: stream.length,
      byAction: countBy(stream, "action"),
      byMode: countBy(stream, "mode"),
      aborted,
      continued,
      // shadow 模式下"本会打断但没有打断"的次数：误判率的观测样本。
      shadowed: stream.filter(row => row.action === "shadowed").length,
      skippedScope: stream.filter(row => row.action === "skipped-scope").length,
    },
    upstream: {
      total: upstream.length,
      byAction: countBy(upstream, "action"),
      byReason: countBy(upstream, "reason"),
      switched: upstream.filter(row => row.action === "switch-profile").length,
      continued: upstream.filter(row => row.action === "continued").length,
      restored: upstream.filter(row => row.action === "restored").length,
    },
  };
}

export function formatRecoverySummary(summary) {
  const lines = [];
  const r = summary.refusal, s = summary.streamWatch, u = summary.upstream;
  lines.push(`refusal.log      ${r.total} 条`);
  lines.push(`  by action      ${JSON.stringify(r.byAction)}`);
  lines.push(`  by category    ${JSON.stringify(r.byCategory)}`);
  lines.push(`  by model       ${JSON.stringify(r.byModel)}`);
  lines.push(`  复核发送 ${r.reviews.sent} / 有结局 ${r.reviews.outcomes} / 救回 ${r.reviews.delivered} / 仍拒 ${r.reviews.stillRefusal} / 挽救率 ${r.reviews.saveRate ?? '无数据'}`);
  lines.push(`stream-watch.log ${s.total} 条`);
  lines.push(`  by action      ${JSON.stringify(s.byAction)}`);
  lines.push(`  by mode        ${JSON.stringify(s.byMode)}`);
  lines.push(`  打断 ${s.aborted} / 续跑 ${s.continued} / 影子命中 ${s.shadowed} / 范围跳过 ${s.skippedScope}`);
  lines.push(`upstream.log     ${u.total} 条`);
  lines.push(`  by action      ${JSON.stringify(u.byAction)}`);
  lines.push(`  by reason      ${JSON.stringify(u.byReason)}`);
  lines.push(`  换档 ${u.switched} / 续跑 ${u.continued} / 还原 ${u.restored}`);
  return lines.join("\n");
}
