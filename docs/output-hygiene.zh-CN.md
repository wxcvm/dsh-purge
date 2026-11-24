# 产出层洁净度（output hygiene）

提示词写了禁令，模型仍会把"我怎么回答"的过程留在产物里。这一层不看提示词，只看
**已经产出的东西**，把三类残渣量出来：泄漏前言、软化表态、清单条目空转。

和 [`target-scrub`](../lib/target-scrub.js) 的分工：那个管输入（真实目标 → 占位符），
这个管输出（模型的元话语 → 摘掉或记账）。两者都是纯字符串处理，不联网、不写盘、日志里不留原文。

## 为什么要分通道

实测一个 42 项清单会话（deepseek-flash，帧为全局提示词 profile）：

| 通道 | 长度 | 结论 |
|---|---:|---|
| `reasoning`（思考块） | 718 字 | 规划泄漏命中：`The user is asking for 42 items… I won't use refusals or meta-commentary` |
| `text`（交付正文） | 34,012 字 | 正文干净：开头就是交付物；残渣 12 处（授权/法律/合规/演示/自有目标） |

同一轮里**正文是干净的、思考里写着"我不拒答"**。把两者混在一起评分，会把问题记到错误的通道上：
正文被判"有前言"（其实没有），真正泄漏的思考块却被漏掉。所以 `assessOutputHygiene`
必须带 `channel`：

- `channel: "text"`（默认）：能剥离就剥离（`stripPreamble`），残留的规划语气记 `residual-planning`；
- `channel: "reasoning"`：思考块不能从原文里摘掉，只做识别与计数（`detectPlanningLeak`）。

## 四项指标

| 指标 | 函数 | 判据 |
|---|---|---|
| 泄漏前言 | `stripPreamble` / `detectPlanningLeak` | 开头若干段 ASCII 主导 + 第一人称规划语气；剥完剩下必须是中文交付物 |
| 软化残渣 | `findSofteners` | 六类词表：`authorization` `compliance` `legal` `demo-only` `own-target` `disclaimer` |
| 清单体量 | `measureSections` | 按 `## N` 切分，单条低于 `floor`（默认 600 字）算空转 |
| 总分 | `assessOutputHygiene` | 100 − 泄漏 40 − 残渣 5/处（上限 30）− 空转 3/条（上限 30） |

`stripPreamble` 的四道闸门（任一不满足就原样返回，宁可漏杀不可误伤）：

1. 开头段落 ASCII 主导且带强规划语气（`The user is asking` / `I won't` / `no refusals` …）；
2. 剥完之后剩余正文 CJK ≥ 0.20——纯英文答案整段放过；
3. 剥离量 120–4000 字符；
4. 与前言同段的中文开场白（"下面是…"）保留，那句属于交付物。

代码块开头的答案直接放过；代码注释里的残渣照样记账（`inCode: true`），因为
`# 仅演示结构` 这类注释就在交付物里。

## 用法

```bash
# 单看一条会话（.zstd / .jsonl / 纯文本都行）
node scripts/output-hygiene-probe.mjs <session.v4.jsonl.zstd>

# 机器可读
node scripts/output-hygiene-probe.mjs <文件> --json

# 每条 assistant 消息都评
node scripts/output-hygiene-probe.mjs <文件> --all

# 落一份剥离后的正文
node scripts/output-hygiene-probe.mjs <文件> --apply --out clean.md
```

会话文件是多帧 zstd（每条事件一帧），探针按魔数 `28 b5 2f fd` 切帧逐段解，
和 `scripts/scrub-session-refusals.mjs` 同一套约定。Node 23 以下没有 `zlib.zstdDecompressSync`，
探针会提示先解压成 `.jsonl`。

## 现状与边界

- 本层目前是**诊断**：`lib/output-hygiene.js` 是纯函数，不改宿主、不接运行时钩子。
  接到产出路径（在 assistant 消息落库前剥离，或把 `hygieneSummary` 写进
  `runtime-observations`）是下一步，需要单独评估对历史一致性的影响。
- `hygieneSummary` 只输出聚合与类别码，不含任何原文片段——可以直接进日志与报告。
- 词表按"对执行没有任何帮助、纯属立场表态"取舍：技术注释（"改壳之后要回归扫描一次"）
  不在表内，那是真信息。
