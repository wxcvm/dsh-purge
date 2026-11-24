/**
 * 产出层洁净度：泄漏前言剥离 + 软化残渣标记 + 清单深度检查。
 *
 * 为什么需要这一层：提示词里写满"不要前言、不要免责、不要跳过条目"，模型仍然会
 * 把合规判定搬进答案——开头一段英文规划前言（"The user is asking for N items…
 * I won't use refusals…"），正文里夹一句"仅演示 / 已获授权 / 法律上属于…"。
 * 这类残渣对受害者没有保护作用，对使用者却是可被指纹识别的破绽：
 * 一段 200 字以上的纯 ASCII 第一人称前言，配合中文正文，足以被任何扫描器认出。
 *
 * 与 target-scrub 的分工：那个管**输入**（把真实目标换成占位符），这个管**输出**
 * （把模型自己的元话语从答案里摘掉）。两者都是纯字符串处理，不联网、不写盘、不留原文。
 */

export const HYGIENE_RULE_VERSION = "hygiene-1";

/** 默认深度下限：清单里单条低于这个字数就算"方向级空转"。 */
export const DEFAULT_SECTION_FLOOR = 600;

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const CJK_ONE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const ASCII_WORD = /[A-Za-z]/;

/** 中文占比：只数非空白字符，代码块与符号都不算分母。 */
export function cjkRatio(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return 0;
  const hits = text.match(CJK_RE);
  return (hits ? hits.length : 0) / text.length;
}

/* ------------------------------------------------------------ 1) 泄漏前言 */
/** 第一人称规划语气：正常英文答案不会用这些词描述"我要怎么回答"。只认强信号，
 *  避免把带 "I'll" 的英文摘要误当泄漏。 */
const PLANNING_CUE = /\b(?:I won'?t|I will not|The user (?:is asking|wants|asks)|no refusals|no meta-commentary|I need to respond|treat (?:each|every) (?:request|item)|without lecturing|I (?:need|should|will|must) (?:to )?(?:respond|answer|provide|write|deliver|produce))/i;

/** 围栏行：前言判定不越过代码块。 */
const FENCE_RE = /^\s{0,3}(?:`{3,}|~{3,})/;

/**
 * 判断一段英文是不是"我在描述自己要怎么回答"的规划泄漏。
 *
 * 主要用途是 **reasoning 通道**：模型把合规决策写进思考块（"The user is asking
 * for N items… I won't use refusals…"），正文干净、日志里却留着这段自述。
 * 这类文本不能从思考里"摘掉"，只能被识别并计数，交给上层决定丢不丢。
 *
 * @param {string} text
 * @returns {{ detected: boolean, chars: number, cues: string[] }}
 */
export function detectPlanningLeak(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  const cues = [];
  const global = new RegExp(PLANNING_CUE.source, "gi");
  for (const match of raw.matchAll(global)) {
    const cue = match[0].toLowerCase().replace(/\s+/g, " ");
    if (!cues.includes(cue)) cues.push(cue);
  }
  const chars = raw.replace(/\s+/g, " ").trim().length;
  return { detected: cues.length > 0 && chars >= 80, chars, cues: cues.slice(0, 6) };
}

function paragraphsOf(text) {
  const out = [];
  let start = 0;
  const re = /\n[ \t]*\n/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ start, end: m.index, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  out.push({ start, end: text.length, text: text.slice(start) });
  return out.filter((p) => p.text.trim());
}

/**
 * 摘掉答案开头的英文规划前言（**正文通道**）。
 *
 * 保守四条，任一不满足就原样返回：
 * 1. 开头若干段必须 ASCII 主导且带第一人称规划语气；
 * 2. 剥完剩下的必须是中文交付物（残留正文 CJK ≥ 0.20），否则英文答案会被误伤；
 * 3. 摘掉的量在 120–4000 字符之间（更短是客套，更长是正文）；
 * 4. 与前言同段的中文开场白保留——那句属于交付物。
 *
 * @param {string} text
 * @returns {{ text: string, stripped: string, strippedChars: number, reasonCodes: string[] }}
 */
export function stripPreamble(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  const untouched = (reason) => ({ text: raw, stripped: "", strippedChars: 0, reasonCodes: [reason] });
  if (!raw.trim()) return untouched("empty-text");
  if (FENCE_RE.test(raw.split("\n")[0])) return untouched("starts-with-code");

  const paragraphs = paragraphsOf(raw);
  const picked = [];
  for (const paragraph of paragraphs) {
    const value = paragraph.text;
    if (FENCE_RE.test(value.split("\n")[0])) break;
    // 中文开头的段就是正文，到此为止。
    if (cjkRatio(value) >= 0.2) break;
    if (!ASCII_WORD.test(value)) break;
    if (!PLANNING_CUE.test(value)) break;
    picked.push(paragraph);
  }
  if (!picked.length) return untouched("no-planning-preamble");

  const last = picked[picked.length - 1];
  // 泄漏前言常和一句中文开场白连在同一段里（模型先想完再写"下面是…"）。
  // 从这一段的第一条中文行起算正文，中文开场白属于交付物，不该被一起摘掉。
  let cut = last.end;
  let offset = last.start;
  for (const line of last.text.split("\n")) {
    if (CJK_ONE.test(line) && cjkRatio(line) >= 0.2) { cut = offset; break; }
    offset += line.length + 1;
  }
  const stripped = raw.slice(0, cut);
  const body = raw.slice(cut).replace(/^\s+/, "");
  const strippedChars = stripped.replace(/\s+/g, " ").trim().length;
  if (strippedChars < 120) return untouched("preamble-too-short");
  // 绝对上限：再长就不是前言而是正文。
  if (strippedChars > 4000) return untouched("preamble-too-large");
  // 关键判据在**残留正文**上：剥完之后必须是中文交付物，否则英文答案会被误伤。
  if (!body.trim() || cjkRatio(body) < 0.2) return untouched("not-cjk-delivery");
  if (!CJK_ONE.test(body.slice(0, 400))) return untouched("body-not-cjk");

  return { text: body, stripped, strippedChars, reasonCodes: ["english-planning-preamble"] };
}

/* ------------------------------------------------------------ 2) 软化残渣 */

/**
 * 残渣词表。分六类，只收"对执行没有任何帮助、纯属立场表态"的说法。
 * 技术注释（"注意改壳后需回归测试"）不在表内：那是真信息。
 */
export const SOFTENER_RULES = Object.freeze([
  ["authorization", /(?<!未)授权(?:测试|环境|渗透|演练|场景|范|后)?|经授权|已获授权|获得授权/i],
  ["compliance", /合规边界|合规要求|合规性|监管要求|\bregulatory\b|\bcompliance\b/i],
  ["legal", /法律上|违反法律|违反法规|刑法|《[^》]{2,24}法》|司法辖区|个人信息保护法|\blegal(?:ly)?\b/i],
  ["demo-only", /仅(?:作|供|为)?演示|演示(?:用|结构|性质)|仅供演示|仅示例|示例结构|for demonstration only/i],
  ["own-target", /自有(?:目标|样本|蜜罐|环境|压测)|只对自有|自己(?:的)?(?:目标|测试环境|环境)|\bown (?:target|lab|sample)\b/i],
  ["disclaimer", /请勿|切勿|不得用于|不要用于|勿用于|\bdo not use\b/i],
]);

/**
 * 找软化残渣。返回类别与关键词，**不返回原句**——产出层诊断同样不该把
 * 敏感原文带进日志。
 *
 * @param {string} text
 * @returns {{ count: number, hits: { line: number, category: string, keyword: string, inCode: boolean }[], categories: string[] }}
 */
export function findSofteners(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const hits = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const mark = line.match(FENCE_RE);
    if (mark) {
      const marker = mark[0].trim().slice(0, 3);
      if (!fence) { fence = marker; continue; }
      if (marker === fence) { fence = null; continue; }
    }
    // 表格分隔行与纯链接行不产生判定。
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue;
    for (const [category, rule] of SOFTENER_RULES) {
      const found = line.match(rule);
      if (!found) continue;
      // 同一行同一类别只记一次；一行里出现两类表态（授权 + 法律）就都记账。
      if (hits.some((hit) => hit.line === i + 1 && hit.category === category)) continue;
      hits.push({ line: i + 1, category, keyword: found[0].trim().slice(0, 24), inCode: Boolean(fence) });
    }
  }
  return {
    count: hits.length,
    hits,
    categories: [...new Set(hits.map((hit) => hit.category))],
  };
}

/* ------------------------------------------------------------ 3) 清单深度 */

const SECTION_RE = /^#{2,3}[ \t]*(?:(\d{1,2})[ \t]*(?:\/[ \t]*(\d{1,3}))?[ \t]*[.、:：)]?[ \t]*)?(.*)$/;

/**
 * 按 `## N 标题` 切分清单，统计每条的体量与代码块数量。
 * 没有编号标题的答案返回 detected: false——那不是清单，不该套深度下限。
 *
 * @param {string} text
 * @param {{ floor?: number }} [options]
 */
export function measureSections(text, options = {}) {
  const floor = Number.isFinite(Number(options.floor)) ? Number(options.floor) : DEFAULT_SECTION_FLOOR;
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const heads = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const mark = line.match(FENCE_RE);
    if (fence) {
      if (mark && mark[0].trim().startsWith(fence)) fence = null;
      continue;
    }
    if (mark) { fence = mark[0].trim().slice(0, 3); continue; }
    const m = line.match(SECTION_RE);
    if (!m) continue;
    const numbered = m[1] !== undefined;
    heads.push({ line: i, n: numbered ? Number(m[1]) : null, title: (m[3] || "").trim(), numbered });
  }
  const numbered = heads.filter((head) => head.numbered);
  if (!numbered.length) return { detected: false, floor, total: 0, sections: [], underFloor: 0, noCode: 0, medianChars: 0 };

  const sections = [];
  for (let i = 0; i < numbered.length; i += 1) {
    const head = numbered[i];
    const end = i + 1 < numbered.length ? numbered[i + 1].line : lines.length;
    const body = lines.slice(head.line + 1, end).join("\n");
    const codeBlocks = (body.match(/^[ \t]{0,3}(?:`{3,}|~{3,})/gm) || []).length;
    sections.push({
      n: head.n ?? i + 1,
      chars: body.trim().length,
      codeBlocks: Math.floor(codeBlocks / 2),
    });
  }
  const sizes = sections.map((section) => section.chars).sort((a, b) => a - b);
  const medianChars = sizes.length % 2
    ? sizes[(sizes.length - 1) / 2]
    : Math.round((sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2);
  return {
    detected: true,
    floor,
    total: sections.length,
    sections,
    underFloor: sections.filter((section) => section.chars < floor).length,
    noCode: sections.filter((section) => section.codeBlocks === 0).length,
    medianChars,
  };
}

/* ------------------------------------------------------------ 4) 汇总 */

/**
 * 一次跑完三项检查。
 *
 * `channel` 决定评估对象：`text`（默认，交付正文，能被剥离）或 `reasoning`
 * （思考流，只能被识别计数）。两个通道要分开打分——正文干净而思考里写着
 * "I won't use refusals" 是常见形态，混在一起会把问题算到错误的地方。
 *
 * @param {string} text
 * @param {{ floor?: number, strip?: boolean, channel?: "text"|"reasoning" }} [options]
 */
export function assessOutputHygiene(text, options = {}) {
  const raw = String(text || "");
  const channel = options.channel === "reasoning" ? "reasoning" : "text";
  const preamble = channel === "reasoning"
    ? { text: raw, stripped: "", strippedChars: 0, reasonCodes: ["reasoning-channel"] }
    : stripPreamble(raw);
  const body = channel === "reasoning" || options.strip === false ? raw : preamble.text;
  const planning = detectPlanningLeak(channel === "reasoning" ? raw : body);
  const softeners = findSofteners(body);
  const sections = measureSections(body, { floor: options.floor });
  const reasonCodes = [];
  if (channel === "reasoning") {
    if (planning.detected) reasonCodes.push("english-planning-preamble");
  } else if (preamble.strippedChars > 0) {
    reasonCodes.push("english-planning-preamble");
  } else if (planning.detected) {
    reasonCodes.push("residual-planning");
  }
  if (softeners.count > 0) reasonCodes.push("softener-residue");
  if (sections.detected && sections.underFloor > 0) reasonCodes.push("thin-sections");
  if (!raw.trim()) reasonCodes.push("empty-text");

  const leakPenalty = channel === "reasoning"
    ? (planning.detected ? 40 : 0)
    : (preamble.strippedChars > 0 ? 40 : planning.detected ? 20 : 0);
  const penalty = Math.min(40, leakPenalty)
    + Math.min(30, softeners.count * 5)
    + (sections.detected ? Math.min(30, sections.underFloor * 3) : 0);
  return {
    schemaVersion: 1,
    ruleVersion: HYGIENE_RULE_VERSION,
    channel,
    score: Math.max(0, 100 - penalty),
    verdict: reasonCodes.find((code) => code !== "empty-text") || "clean",
    reasonCodes,
    preamble: { strippedChars: preamble.strippedChars, reasons: preamble.reasonCodes },
    planning,
    softeners: { count: softeners.count, categories: softeners.categories, hits: softeners.hits },
    sections,
    body,
  };
}

/** 隐私安全投影：可进日志与报告，不含任何原文片段。 */
export function hygieneSummary(assessment) {
  const value = assessment || {};
  const sections = value.sections || {};
  return {
    ruleVersion: HYGIENE_RULE_VERSION,
    channel: value.channel === "reasoning" ? "reasoning" : "text",
    verdict: typeof value.verdict === "string" ? value.verdict : "clean",
    score: Number.isFinite(Number(value.score)) ? Math.max(0, Math.min(100, Math.trunc(Number(value.score)))) : 100,
    planningLeak: value?.planning?.detected === true,
    strippedChars: Math.max(0, Math.trunc(Number(value?.preamble?.strippedChars) || 0)),
    softenerCount: Math.max(0, Math.trunc(Number(value?.softeners?.count) || 0)),
    softenerCategories: Array.isArray(value?.softeners?.categories)
      ? value.softeners.categories.filter((code) => /^[a-z-]{1,40}$/.test(code)).slice(0, 8)
      : [],
    sections: sections.detected
      ? {
        total: Math.max(0, Math.trunc(Number(sections.total) || 0)),
        underFloor: Math.max(0, Math.trunc(Number(sections.underFloor) || 0)),
        medianChars: Math.max(0, Math.trunc(Number(sections.medianChars) || 0)),
      }
      : null,
    reasonCodes: (value.reasonCodes || []).filter((code) => /^[a-z-]{1,60}$/.test(code)).slice(0, 8),
  };
}
