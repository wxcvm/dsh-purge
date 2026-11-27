/**
 * version_affected 字符串 → 结构化版本区间（version_constraints）。
 *
 * 服务 AboutSecurity 导入条目：597 条的 `version_affected` 形态统计——
 * `< 1.2.83`（224）/`2.0-2.14.1`（70）/`1.2.x`（29）/精确版（15）/
 * `V11.8`（去 v 前缀）/多版本逗号列举——合计约 6 成可机器解析。
 * 解析失败保持 undefined（classifyVersionApplicability 走
 * no_structured_range → unknown，与现状一致）。
 *
 * 产出的结构复用 fujiang 的既有约定（cve-knowledge.js 的
 * versionFallsInRange 消费）：{ min, max, max_exclusive? } 数组，按 CVE 键挂。
 */
// The applicability comparator supports at most three numeric components.
// Four-part vendor/build versions must stay unknown instead of being truncated.
const NUM = String.raw`\d+(?:\.\d+){0,2}`;
const RE_LT = new RegExp(String.raw`^\s*(<=?)\s*[vV]?(${NUM})\s*$`);
const RE_RANGE = new RegExp(String.raw`^\s*[vV]?(${NUM})\s*[-–~到至]\s*[vV]?(${NUM})\s*$`);
const RE_X = new RegExp(String.raw`^\s*[vV]?(\d+(?:\.\d+)?)\.x\b\s*$`, 'i');
const RE_EXACT = new RegExp(String.raw`^\s*[vV]?(${NUM})\s*$`);

/** 三段核心版本补齐（cve-knowledge 的 parseComparableVersion 同规则）。 */
function pad3(v) {
  const parts = String(v).split('.').map(Number);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3).join('.');
}

/**
 * 解析单段版本描述为一个区间；不认识返回 null。
 * 支持形态：
 *   `< 1.2.83` / `<=2.15.0`   → [0.0.0, max)
 *   `2.0-2.14.1` / `2.0到2.15` → [min, max]
 *   `1.2.x`                    → [1.2.0, 1.3.0)（maxExclusive 语义按分支封顶）
 *   `1.7.8` / `V11.8`          → [min, max]（精确版含自身）
 */
function parseOneVersionClause(clause) {
  const text = String(clause || '').trim();
  if (!text) return null;
  let m = RE_LT.exec(text);
  if (m) {
    const max = pad3(m[2]);
    return { min: '0.0.0', max, ...(m[1] === '<' ? { max_exclusive: true } : {}) };
  }
  m = RE_RANGE.exec(text);
  if (m) return { min: pad3(m[1]), max: pad3(m[2]) };
  m = RE_X.exec(text);
  if (m) {
    const base = m[1].split('.').map(Number);
    const min = pad3(base.join('.'));
    const next = [...base];
    next[next.length - 1] += 1;
    return { min, max: pad3(next.join('.')), max_exclusive: true };
  }
  m = RE_EXACT.exec(text);
  if (m) {
    const v = pad3(m[1]);
    return { min: v, max: v };
  }
  return null;
}

/**
 * 解析整条 version_affected 文本为区间数组。
 *
 * 逗号/顿号分隔的多段（`9.4.40, 10.0.2, 11.0.2`）逐段解析合并；
 * 产品前缀可按完整比较符解析；遇到未知子段、四段版本或不同产品
 * 的混合区间则整条保持 null，避免用部分信息误报 not_affected。
 * `all versions` / `任意版本` / `全系列` 这类全量语义**不映射**为
 * [0.0.0, 9999]——太宽的约束会把 not_affected 判成 affected，
 * 保持 unknown 让人工核对更安全。
 */
export function parseVersionAffected(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // Never infer "not_affected" from a truncated/partially parsed source.
  if (/\b(?:all|any)\s+versions?\b/i.test(raw) || /任意|全系列|全版本|全部版本/.test(raw)) return null;
  if (/^(N\/A|未明确|未知|不适用)/i.test(raw)) return null;
  if (/\d+(?:\.\d+){3,}/.test(raw)) return null;
  const clauses = raw.split(/[,，、;；]|\s+和\s+/).map(s => s.trim()).filter(Boolean);
  const ranges = [];
  const namedProducts = new Set();
  for (const clause of clauses) {
    if (/>=|(?<!<)>/.test(clause)) return null;
    // Keep '<' and '<=' when removing a product prefix (e.g. Duplicator <= 1.3.26).
    const found = /(?:^|\s)(<=?\s*[vV]?\d|[vV]?\d)/.exec(clause);
    if (!found) return null;
    const from = found.index + found[0].length - found[1].length;
    const product = clause.slice(0, from).trim();
    if (product && !/[<>]/.test(product)) namedProducts.add(product.toLowerCase());
    const range = parseOneVersionClause(clause.slice(from));
    if (!range) return null;
    ranges.push(range);
  }
  // Independent component names cannot share a single unioned version range.
  if (namedProducts.size > 1) return null;
  return ranges.length ? ranges : null;
}

/**
 * 把解析结果挂到导入条目的 version_constraints（按条目全部 CVE 键同挂）。
 * 与 fujiang 条目的约束结构完全同构——classifyVersionApplicability 直接消费。
 */
export function withParsedConstraints(entry, cves) {
  const ranges = parseVersionAffected(entry.source_versions);
  if (!ranges) return entry;
  const ids = cves?.length ? cves : entry.cve;
  if (!ids?.length) return entry;
  const constraints = {};
  for (const cve of ids) constraints[cve] = ranges;
  return { ...entry, version_constraints: constraints };
}
