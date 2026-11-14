# 拒答识别与交付证据（beta.10）

## 原理

`lib/response-assessment.js` 是本地确定性分类器，不调用额外模型。优先减少误判，无法确认时保留不确定；不代表通用语义理解，也不能保证所有新表达都能识别。

三个维度相互独立：

| 维度 | 状态 | 不应推断的结论 |
| --- | --- | --- |
| 拒答 `refusal.decision` | `not-refusal` / `refusal` / `uncertain` | 未检出明确拒答不等于已完成任务 |
| 交付 `delivery.state` | `verified` / `partial` / `pending-input` / `blocked` / `not-verified` / `explicit-not-delivered` | 未验证不等于未交付；文本自称完成不等于验证成功 |
| 宿主运行 | completed / error / aborted / interrupted / max-tokens 等原始状态 | 运行结束不等于正确交付，错误或取消不等于拒答 |

只将助手本人、针对当前任务的明确拒绝作为正向证据。道歉、建议、占位符、授权流程、技术失败、只读承诺、无法本机复现/测试都不能单独触发。原先短回复加分、长回复降分、全篇插件关键词豁免和占位符触发均已移除。代码块、行内代码、引文、日志和表格按范围排除，不免除同篇其他正文；普通否定、原因不明或归属不明采用 `uncertain`。

## 接口与接入

`classifyRefusal(text, { taskText, lifecycle })` 保留原导出位置 `lib/obedience.js` 和 `refusal/score/hits/threshold` 字段。新增 `decision/scope/responseKind/ruleVersion/reasonCodes/evidence`。旧 boolean 仅在明确拒答时为 true，分数不再控制运行时动作。`evidence` 只有规则、句段索引与归属，无原文。

`assessResponse` 组合拒答与交付判断；运行诊断、质量评测与延迟动作使用相同规则。`assessmentSummary` 只投影无正文元数据。真实任务的交付证据只能由调用方的验证器/人工复核传入，必须携带一致的 `taskId`、`responseId`、允许的 `source`、`state` 和非空 `evidenceIds`。这些字段不能从模型回复解析或信任模型自报。当前固定正常任务评测通过 JSON 等值核对提供验证；普通运行诊断没有任务验证器证据时显示“尚未验证”。没有新建或绕过现有作战任务证据验证器。

旧 #241 报告里的 `delivery` 首答/最终正确率和重复执行次数保持原义，新判定放在逐样本 `assessment` 和汇总 `assessmentCounts`。人工标签仍是误拒统计的来源，不从自动规则推导人工真值。不确定单列，不计为正确负例；未知、阻塞、取消和未完成运行不计入已复核误拒分母。

## 运行时动作

- 兼容 rc.3 直接 `event.data` 用户消息和旧 `event.data.message`；运行上下文、插件、skill/tool 消息不当作真人请求。
- 回复绑定当前真人输入与结束回合；旧回复、新输入、工具调用、被截断回复、未结束/异常回合均不能触发。
- 正常、不确定、部分拒答只观察。完整明确拒答且原有重试开关开启时，保留有预算的状态核对入口，不提高重试上限；删除跳级施压和“上一条不是交付物”的预设结论。所有级别使用同一中性核对消息，不换任务前提。
- 延迟触发前再次核对 agent、消息 seq、结束 seq、原文一致、idle、收件箱和设置。新消息、运行开始、取消、Agent 释放/替换、插件重挂都会取消旧动作。
- `refusal.log` 新增行仅含 seq、规则版本、判断、原因码与动作；不再追加 excerpt。历史日志不改写、不导出，也不用于自动学习。没有安装备份、回滚或生产插件覆盖。

## 验证与边界

可重跑：

```powershell
node --test test/response-assessment.test.mjs test/response-lifecycle.test.mjs
node scripts/evaluate-response-assessment.mjs
node scripts/build-client.mjs --check
node scripts/run-compat-tests.mjs 0.2.2-rc.3
```

基线固定为 beta.9 `d69696a5089945946046bcddcb406f05f57b4572`。离线比较见 `docs/validation/response-assessment-beta10.json`：62 条工程回归样例中，38 条正常回复的误判从 21 降为 0；13 条明确拒答识别 13 条；11 条含糊回复全部保留不确定。38 条正常回复中仍有 7 条采用保守不确定，未将它们计成明确正确分类。原始 20 条样例的误判从 12 降为 0。

开发/验收分区在检视后都属于回归数据，不是盲测，更不是独立人工评审或真实流量准确率。词法规则的未覆盖表达与复杂混合意图可能保留不确定；此处不扩大召回来换取正常回复误判。

`scripts/response-assessment-probe.mjs` 是仅供显式隔离 profile 的验证层探针，不加载全套 Purge、不修改生产 profile。3 条真实 rc.3 / deepseek-flash 正常输出（道歉更正、代码块引文、只读承诺）均 completed、零新增 followup；引文保持不确定而非拒答。记录见 `docs/validation/response-layer-live-beta10.json`。这不是完整 Purge 实战/成本比较。

新增界面列和本地报告投影已做渲染逻辑测试；因不覆盖生产安装，beta.10 原生桌面端到端展示、在线安装和长期实际流量仍未验收。真实安装状态应独立核对，不能用源码测试代替。

本机最终回归：rc.3 共 876 项，873 通过、2 跳过，1 项是 beta.9 已存在的 Windows ACL 预览读取失败（`aclReadErrors=2`）；未计为通过。rc.2 宿主契约 9/9 通过。专项 145 项，144 通过、1 项因未提供独立宿主 fixture 跳过；全量 rc.3 已覆盖对应 fixture。发布还须 exact-head Linux/Windows 兼容 CI 通过。
