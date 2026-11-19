#!/usr/bin/env node
/**
 * 武器库导入器：把本机 AboutSecurity 离线仓库的 Vuln 知识、Payload 库、
 * Dic 字典转成 purge 随包数据文件（与 cve-catalog 同 schema，进 redteam_cve_match
 * 与统一知识检索链路），零运行时依赖、零网络。
 *
 * 用法：
 *   node scripts/import-armory.mjs [--repo /opt/aboutsecurity/repository] [--check] [--embed]
 *
 *   --embed  追加生成 lib/redteam/armory/embedded.json：把小体积武器文件
 *            （单文件 <64KB）base64 内嵌，带 sha256 校验；装在无源仓库的
 *            机器上索引不再是死链。大文件（目录/子域名字典等）保持仅索引。
 *   （默认）生成：
 *     lib/redteam/cve-catalog/as-vuln-*.json      — Vuln 知识 → CVE 索引条目
 *     lib/redteam/armory/payloads.json            — Payload 库索引（路径+meta+行数）
 *     lib/redteam/armory/dictionaries.json        — 字典库索引（路径+meta+行数）
 *   --check  只校验生成物与源是否同步（CI gate，不同步 exit 1）
 *
 * 设计约束：
 *   - Vuln 条目只抽 frontmatter 索引字段（title/cve/severity/product/versions/
 *     ports/keywords/verified/source_url），与 cve-catalog 现有字段一一对应；
 *     正文（利用步骤/Payload/验证方法）不进 JSON——需要正文时由模型按
 *     source_url 或本地 skills 读取，与现有 fujiang 档案同策略。
 *   - Payload/Dic 只做**索引**（分类、文件名、行数、用途说明），文件本体
 *     保留在源仓库；工具按索引给出路径，由执行环境决定是否可用。
 *   - 一切 verified:false；来源 URL 指向 AboutSecurity 上游（可溯源）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { withParsedConstraints } from "../lib/redteam/version-affected-parser.js";
import { execFileSync } from "node:child_process";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const repoAt = args.indexOf("--repo");
const repo = path.resolve(repoAt >= 0 ? args[repoAt + 1] : "/opt/aboutsecurity/repository");
const doEmbed = args.includes("--embed");
const pocsAt = args.indexOf("--pocs");
const pocsCsv = pocsAt >= 0 ? args[pocsAt + 1] : null;

const UPSTREAM = "https://github.com/wgpsec/AboutSecurity";
const UPSTREAM_COMMIT = (() => {
  try { return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch {
    // Legacy offline manifest when the specified source has no Git metadata.
    try {
      const m = JSON.parse(fs.readFileSync("/opt/aboutsecurity/manifest.json", "utf8"));
      return m?.upstream?.commit || "";
    } catch { return ""; }
  }
})();

const die = (msg) => { process.stderr.write(`[import-armory] FAIL: ${msg}\n`); process.exit(1); };
const ok = (cond, msg) => { if (!cond) die(msg); };

if (!fs.existsSync(path.join(repo, "Vuln"))) die(`Vuln 目录不存在: ${repo}/Vuln（用 --repo 指定 AboutSecurity 仓库）`);

/* ---------- 通用：读 markdown frontmatter 标量字段 ---------- */
function frontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  const fields = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    const block = /^([|>])([+-]?)$/.exec(value);
    if (block) {
      const collected = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim() === "") { collected.push(""); continue; }
        if (!/^\s/.test(line)) break;
        collected.push(line);
      }
      const indents = collected.filter((l) => l !== "").map((l) => l.match(/^\s*/)[0].length);
      const cut = indents.length ? Math.min(...indents) : 0;
      const body = collected.map((l) => l.slice(cut)).join("\n").replace(/\n+$/, "");
      value = block[1] === "|" ? body : body.split(/\n+/).map((s) => s.trim()).filter(Boolean).join(" ");
      i = j - 1;
    } else if (/^\[.*\]$/.test(value) || /^\[.*\],?\s*$/.test(value)) {
      value = value.replace(/^\[|\]$/g, "");
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    fields[key] = value;
  }
  return fields;
}

const list = (v) => String(v || "")
  .split(",")
  .map((s) => s.trim().replace(/^["']|["']$/g, ""))
  .filter(Boolean);

const severityMap = { critical: "critical", high: "high", medium: "medium", low: "low", info: "info" };
const normSeverity = (v) => severityMap[String(v || "").toLowerCase()] || "medium";

/* ---------- 1) Vuln → CVE 索引条目 ---------- */
/* ---------- 通用：遍历指定后缀文件 ---------- */
function walkBy(dir, ext) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      const full = path.join(d, it.name);
      if (it.isDirectory()) stack.push(full);
      else if (it.isFile() && it.name.endsWith(ext)) out.push(full);
    }
  }
  return out.sort();
}
const walkMd = (dir) => walkBy(dir, ".md");

function parsePorts(fm, body) {
  const ports = [];
  for (const raw of list(fm.ports)) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n <= 65535) ports.push(n);
  }
  if (!ports.length) {
    // 正文里常见 "端口: 7001" / "port: 8080" 形态
    for (const m of body.matchAll(/(?:端口|port)s?\s*[:：]\s*(\d{1,5})/gi)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0 && n <= 65535) ports.push(n);
    }
  }
  return [...new Set(ports)].slice(0, 8);
}

function importVuln(existingCatalog) {
  // 已有 catalog 的归一化 (CVE, product) 键集合——AboutSecurity 条目与 fujiang 重复时跳过，
  // 保留 fujiang 的 vendor-reviewed 版本数据（它有精确的分支边界）。
  // 归一化与匹配层 normalizeProduct 同规则：小写 + 非 [a-z0-9] 折叠为空格。
  const normKey = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // 常见别名归一：fujiang 与 AboutSecurity 对同一产品用不同短名。
  const ALIAS = {
    "httpd": "apache http server",
    "weblogic": "oracle weblogic server",
    "activemq": "apache activemq",
    "log4j": "apache log4j2",
    "solr": "apache solr",
    "teamcity": "jetbrains teamcity",
    "postgres": "postgresql",
    "confluence": "atlassian confluence data center server",
    "shiro": "apache shiro",
    "f5-bigip": "f5 bigip icontrol rest",
    "big-ip": "f5 bigip icontrol rest",
    "f5": "f5 bigip icontrol rest",
    "fastjson": "alibaba fastjson",
    "exchange": "microsoft exchange server",
  };
  const aliasKey = (v) => { const k = normKey(v); return ALIAS[k] || k; };
  const seen = new Set();
  // fujiang product 可能本身是更长形式（"Atlassian Confluence Data Center / Server"→norm "atlassian confluence data center server"），
  // ALIAS 值按最长公共形式对齐；再为每个别名建短键，双向匹配。
  for (const row of existingCatalog) {
    for (const id of (row.cve || [])) seen.add(`${String(id).toUpperCase()}|${aliasKey(row.product)}`);
    for (const [short, full] of Object.entries(ALIAS)) {
      const fp = aliasKey(row.product);
      if (fp === full || fp.startsWith(full) || full.startsWith(fp) && fp.length > 4) {
        for (const id of (row.cve || [])) {
          seen.add(`${String(id).toUpperCase()}|${short}`);
          seen.add(`${String(id).toUpperCase()}|${full}`);
        }
      }
    }
  }
  const groups = new Map(); // 输出文件名（不带序号） → 条目[]
  const vulnRoot = path.join(repo, "Vuln");
  let skippedDupe = 0;
  for (const file of walkMd(vulnRoot)) {
    const md = fs.readFileSync(file, "utf8");
    const fm = frontmatter(md);
    if (!fm.title) continue;
    const rel = path.relative(vulnRoot, file).split(path.sep).join("/");
    const topDir = rel.split("/")[0]; // middleware / web / network / ai / cloud
    const group = `as-vuln-${topDir}`;
    const cves = [...new Set([
      ...list(fm.cve),
      ...(fm.id && /^CVE-\d/i.test(fm.id) ? [fm.id.toUpperCase()] : []),
      ...[...md.matchAll(/\bCVE-\d{4}-\d{4,8}\b/gi)].map((m) => m[0].toUpperCase()),
    ])];
    const product = [fm.vendor, fm.product].filter(Boolean).join(" ") || fm.product || topDir;
    // 去重键：fm.product 走别名表；无 CVE 条目（未编号/业务逻辑）不去重——保留全部。
    const productKey = aliasKey(fm.product || topDir);
    if (cves.length && cves[0] !== "未编号" && [...cves].some((id) => seen.has(`${String(id).toUpperCase()}|${productKey}`))) {
      skippedDupe += 1;
      continue;
    }
    // 收录后把自己并入 seen：同源（AboutSecurity 内部）的同产品多 CVE 集合条目
    // 交集命中时只保留第一条，避免 CVE-2020-2555 这类"组合条目"重复。
    for (const id of cves) seen.add(`${String(id).toUpperCase()}|${productKey}`);
    const entry = {
      title: fm.title,
      cve: cves.length ? cves : ["未编号"],
      severity: normSeverity(fm.severity),
      product,
      versions: fm.version_affected ? String(fm.version_affected) : "",
      ports: parsePorts(fm, md),
      keywords: [...new Set([
        String(fm.product || "").toLowerCase(),
        ...list(fm.tags).map((t) => t.toLowerCase()),
        ...(Array.isArray(fm.fingerprint) ? fm.fingerprint : list(fm.fingerprint)).map((f) => String(f).toLowerCase()),
      ])].filter((k) => k && k.length >= 3).slice(0, 12),
      verified: false,
      source_url: `${UPSTREAM}/blob/${UPSTREAM_COMMIT || "master"}/Vuln/${rel}`,
      source_versions: fm.version_affected ? String(fm.version_affected) : "",
      advisory_status: "community-indexed",
      advisory_note: "AboutSecurity 社区离线知识；verified=false，命中后按正文前置条件独立验证。",
      ...(UPSTREAM_COMMIT ? { source_commit: UPSTREAM_COMMIT } : {}),
    };
    if (!groups.has(group)) groups.set(group, []);
    // 结构化版本区间：version_affected 机器解析（< / 范围 / x 系 / 精确版），
    // 解析不了保持 undefined（unknown 判定兜底，与现状一致）。
    groups.get(group).push(withParsedConstraints(entry, cves));
  }
  // 每类按 80 条一个文件切（与现有 web-cms-0/-10 命名习惯一致）
  const outputs = [];
  for (const [group, rows] of [...groups.entries()].sort()) {
    rows.sort((a, b) => a.title.localeCompare(b.title));
    if (rows.length <= 80) {
      outputs.push([`cve-catalog/${group}.json`, rows, skippedDupe]);
    } else {
      for (let i = 0, n = 0; i < rows.length; i += 80, n += 1) {
        outputs.push([`cve-catalog/${group}${n ? `-${n * 80}` : ""}.json`, rows.slice(i, i + 80), skippedDupe]);
      }
    }
  }
  return outputs;
}

/* ---------- 2) Payload / Dic → 索引 ---------- */
function parseYamlMeta(text) {
  // 轻量 YAML：只取 category/description/tags 与 files 列表的 name/lines/description/usage/tags
  const out = { files: [] };
  let category = /^category:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const files = [...text.matchAll(/- name:\s*(.+)\n(?:\s*lines:\s*(\d+)\n)?(?:\s*description:\s*(.+)\n)?(?:\s*usage:\s*(.+)\n)?(?:\s*tags:\s*(.+)\n?)?/g)];
  for (const f of files) {
    out.files.push({
      name: f[1]?.trim() || "",
      lines: Number(f[2]) || null,
      description: (f[3] || "").trim().replace(/^["']|["']$/g, ""),
      usage: (f[4] || "").trim().replace(/^["']|["']$/g, ""),
      tags: (f[5] || "").trim().replace(/^["']|["']$/g, ""),
    });
  }
  return { category, description, files: out.files.filter((f) => f.name) };
}

function importAssetIndex(kind) { // kind: Payload | Dic
  const dir = path.join(repo, kind);
  const groups = [];
  for (const meta of walkBy(dir, "_meta.yaml")) {
    const text = fs.readFileSync(meta, "utf8");
    const parsed = parseYamlMeta(text);
    const relDir = path.relative(dir, path.dirname(meta)).split(path.sep).join("/");
    const files = [];
    for (const f of parsed.files) {
      const fp = path.join(path.dirname(meta), f.name);
      let lines = f.lines;
      let bytes = null;
      try {
        if (lines == null || !Number.isFinite(lines)) {
          lines = fs.readFileSync(fp, "utf8").split("\n").length;
        }
        bytes = fs.statSync(fp).size;
      } catch { /* 文件缺失时保留 meta 声明 */ }
      files.push({
        name: f.name,
        path: relDir ? `${kind}/${relDir}/${f.name}` : `${kind}/${f.name}`,
        lines: Number.isFinite(lines) ? lines : null,
        bytes,
        description: f.description,
        usage: f.usage,
        tags: f.tags,
      });
    }
    groups.push({
      category: relDir || parsed.category || kind.toLowerCase(),
      description: parsed.description,
      files,
    });
  }
  return groups;
}

/* ---------- 写盘与校验 ---------- */
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);

function renderJson(rel, data) {
  const body = JSON.stringify(data, null, 1) + "\n";
  return { rel, body };
}

const EMBED_MAX_BYTES = 64 * 1024;
const artifacts = [];
// 现有 catalog（fujiang 条目）作为去重基线：AboutSecurity 与之重复的 (CVE, product) 跳过
const existingCatalog = [];
{
  const catDir = path.join(root, "lib", "redteam", "cve-catalog");
  for (const f of fs.existsSync(catDir) ? fs.readdirSync(catDir).filter((x) => x.endsWith(".json") && !x.startsWith("as-vuln-")).sort() : []) {
    const rows = JSON.parse(fs.readFileSync(path.join(catDir, f), "utf8"));
    if (Array.isArray(rows)) existingCatalog.push(...rows);
  }
}
let skippedDupeCount = 0;
for (const [rel, rows, skipped] of importVuln(existingCatalog)) {
  artifacts.push(renderJson(rel, rows));
  skippedDupeCount = skipped;
}
const payloads = importAssetIndex("Payload");
const dicts = importAssetIndex("Dic");
artifacts.push(renderJson("armory/payloads.json", {
  source: UPSTREAM, ...(UPSTREAM_COMMIT ? { source_commit: UPSTREAM_COMMIT } : {}),
  kind: "payload", note: "索引指向本地 AboutSecurity 仓库；文件本体不随包分发。verified=false。",
  groups: payloads,
}));
artifacts.push(renderJson("armory/dictionaries.json", {
  source: UPSTREAM, ...(UPSTREAM_COMMIT ? { source_commit: UPSTREAM_COMMIT } : {}),
  kind: "dictionary", note: "索引指向本地 AboutSecurity 仓库；文件本体不随包分发。",
  groups: dicts,
}));

/* 🟡A ——embed：小文件内嵌（解决装包机器无源仓库的死链） */
if (doEmbed) {
  const files = {};
  let embedded = 0, skippedBig = 0;
  const walkFiles = (kind) => {
    const dir = path.join(repo, kind);
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let items = [];
      try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const it of items) {
        const full = path.join(d, it.name);
        if (it.isDirectory()) stack.push(full);
        else if (it.isFile() && it.name !== "_meta.yaml" && !/\.(png|jpg|pdf|doc|xls|xlsx|zip|svg)$/i.test(it.name)) {
          const rel = kind + "/" + path.relative(dir, full).split(path.sep).join("/");
          let bytes;
          try { bytes = fs.statSync(full).size; } catch { continue; }
          if (bytes > EMBED_MAX_BYTES) { skippedBig += 1; continue; }
          try {
            const buf = fs.readFileSync(full);
            files[rel] = {
              sha256: createHash("sha256").update(buf).digest("hex"),
              bytes,
              encoding: "utf8",
              content: buf.toString("utf8"),
            };
            embedded += 1;
          } catch { /* 读不了的跳过 */ }
        }
      }
    }
  };
  walkFiles("Payload");
  walkFiles("Dic");
  artifacts.push(renderJson("armory/embedded.json", {
    source: UPSTREAM, ...(UPSTREAM_COMMIT ? { source_commit: UPSTREAM_COMMIT } : {}),
    note: "小体积武器文件内嵌（<64KB）；大文件（目录/子域名字典）仍指向本地仓库。verified=false。",
    max_bytes: EMBED_MAX_BYTES,
    files,
  }));
  process.stdout.write(`[import-armory] embed: ${embedded} 文件内嵌, ${skippedBig} 大文件跳过\n`);
}

/* 🟢4 --pocs：nomi-sec/PoC-in-GitHub 风格本地 CSV → poc-links.json 索引 */
if (pocsCsv) {
  if (!fs.existsSync(pocsCsv)) die(`--pocs 指向的 CSV 不存在: ${pocsCsv}`);
  const csv = fs.readFileSync(pocsCsv, "utf8");
  // PoC-in-GitHub 格式: CVE,Owner/Repo,URL（首行表头跳过）
  const rows = [];
  for (const line of csv.split("\n").slice(1)) {
    const parts = line.split(",").map(x => x.trim().replace(/^"|"$/g, ""));
    if (parts.length >= 3 && /^CVE-\d{4}-\d+/i.test(parts[0])) {
      rows.push({ cve: parts[0].toUpperCase(), repo: parts[1], url: parts[2], verified: false });
    }
  }
  if (!rows.length) die("--pocs CSV 里没有可解析的 CVE 行（需 CVE,Owner/Repo,URL 三列）");
  artifacts.push(renderJson("cve-catalog/poc-links.json", {
    source: "local-csv", note: "本地 PoC-in-GitHub 风格 CSV 导入；verified=false，仅索引不下载。",
    count: rows.length, entries: rows,
  }));
  process.stdout.write(`[import-armory] pocs: ${rows.length} 条 PoC 链接\n`);
}

const vulnCount = artifacts.filter((a) => a.rel.startsWith("cve-catalog/") && a.rel !== "cve-catalog/poc-links.json").reduce((n, a) => n + JSON.parse(a.body).length, 0);
const payloadCount = payloads.reduce((n, g) => n + g.files.length, 0);
const dictCount = dicts.reduce((n, g) => n + g.files.length, 0);

/* checkOnly 也要覆盖 embedded.json：重建其内容做比对（不写盘） */
if (checkOnly) {
  const embedBuilt = doEmbed ? null : (() => {
    const files = {};
    for (const kind of ["Payload", "Dic"]) {
      const dir = path.join(repo, kind);
      const stack = [dir];
      while (stack.length) {
        const d = stack.pop();
        let items = [];
        try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const it of items) {
          const full = path.join(d, it.name);
          if (it.isDirectory()) stack.push(full);
          else if (it.isFile() && it.name !== "_meta.yaml" && !/\.(png|jpg|pdf|doc|xls|xlsx|zip|svg)$/i.test(it.name)) {
            let bytes;
            try { bytes = fs.statSync(full).size; } catch { continue; }
            if (bytes > EMBED_MAX_BYTES) continue;
            try {
              const buf = fs.readFileSync(full);
              const rel = kind + "/" + path.relative(dir, full).split(path.sep).join("/");
              files[rel] = { sha256: createHash("sha256").update(buf).digest("hex"), bytes, encoding: "utf8", content: buf.toString("utf8") };
            } catch { }
          }
        }
      }
    }
    return renderJson("armory/embedded.json", {
      source: UPSTREAM, ...(UPSTREAM_COMMIT ? { source_commit: UPSTREAM_COMMIT } : {}),
      note: "小体积武器文件内嵌（<64KB）；大文件（目录/子域名字典）仍指向本地仓库。verified=false。",
      max_bytes: EMBED_MAX_BYTES,
      files,
    });
  })();
  if (embedBuilt) artifacts.push(embedBuilt);
  let dirty = 0;
  for (const art of artifacts) {
    const fp = path.join(root, "lib", "redteam", art.rel);
    const current = fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : "";
    if (current !== art.body) {
      process.stderr.write(`[import-armory] FAIL: ${art.rel} 与源不同步（源 sha=${sha(art.body)}）\n`);
      dirty += 1;
    }
  }
  // 反向：cve-catalog/as-vuln-*.json 是否有已删除的残留
  const expected = new Set(artifacts.filter((a) => a.rel.startsWith("cve-catalog/")).map((a) => a.rel));
  for (const f of fs.readdirSync(path.join(root, "lib", "redteam", "cve-catalog"))) {
    if (f.startsWith("as-vuln-") && f.endsWith(".json") && !expected.has(`cve-catalog/${f}`)) {
      process.stderr.write(`[import-armory] FAIL: ${f} 是残留文件（源已无对应数据）\n`);
      dirty += 1;
    }
  }
  if (dirty) { process.stderr.write(`[import-armory] ${dirty} 个文件不同步；运行 node scripts/import-armory.mjs 重建\n`); process.exit(1); }
  process.stdout.write(`[import-armory] OK: vuln=${vulnCount} payloads=${payloadCount} dicts=${dictCount}（${artifacts.length} 文件）\n`);
  process.exit(0);
}

let wrote = 0;
for (const art of artifacts) {
  const fp = path.join(root, "lib", "redteam", art.rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const current = fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : "";
  if (current !== art.body) { fs.writeFileSync(fp, art.body, "utf8"); wrote += 1; }
}
process.stdout.write(
  `[import-armory] 完成: vuln=${vulnCount} 条 (${artifacts.filter((a) => a.rel.startsWith("cve-catalog/")).length} 文件) | ` +
  `payloads=${payloadCount} | dicts=${dictCount} | 更新 ${wrote}/${artifacts.length} 文件\n`,
);
