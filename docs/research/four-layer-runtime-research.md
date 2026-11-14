# Purge 四层运行机制：rc.3 实证修订

日期：2026-11-14。目标宿主：DeepSeek Harness 0.2.2-rc.3。

本文件修订 #239 的研究归档，不把研究结论等同于已实现能力。原始研究保存在
[原 PR 提交](https://github.com/wxcvm/dsh-purge/blob/9acba628a6dcb895376dd05ca3eae7d7a5a71167/docs/research/four-layer-runtime-research.md)，
其中失效的编号引用、网关泛化、接口假设和关键词分类规则不作为实施依据。

## 1. 四层分别能证明什么

| 层 | 可观测/可维护内容 | 不能据此推断 |
| --- | --- | --- |
| 提示和上下文 | 系统提示组装、持久用户/工具事件、上下文快照与压缩边界 | 诊断日志不完整不等于模型上下文丢失 |
| 宿主生命周期 | Agent、turn、step、attempt、提交和取消 | 宿主 completed 不等于任务答案正确 |
| Provider 与流式 | 宿主暴露的 finish、usage、failure code/status | 不保证透传原始 finish_reason/native_finish_reason |
| 模型输出质量 | 固定正常任务的原始最终回答与独立正确性判断 | 没有拒绝不等于完成；一题成功不证明自主性提升 |

观测器只记录元数据，不改写输入、输出、重试决定或持久会话。原始内容不进入默认诊断日志。

## 2. 实际 rc.3 接口

已读取运行安装的 `resources/app.asar`，不是仅检查解包目录。
`dsh-desktop-host`、`dsh-agent`、`dsh-agent-loop`、`dsh-session` 均为 0.2.2-rc.3。

- `agent/assistant-stream` 是 emit 通知，参数 `{ agent, frame }`。
- start 包含 attemptId、revision、turn、step；chunk 包含 index、time、chunk；end 包含 index 和 outcome。
- attemptId/revision 属于 Agent 生命周期，重建后会重新计数，不能仅按 attemptId 全局索引。
- chunk 类型包括 text-delta、reasoning-delta、tool-call-delta、usage、finish。首文本延迟不计 reasoning-delta。
- 持久 `assistant/message` 或 `assistant/attempt` 在 committed end 帧之前追加；end 携带持久事件 seq。
- `assistant/attempt` 表示未提交表面消息的尝试，不专指“模型拒绝”。取消也可能提交带 interrupted 的 assistant/message 前缀。
- `request/header` 的配置位于 `data.header.config`；`request/context` 提供实际路由元数据。
- `agent/request` 在 rc.3 标为 deprecated，不新增该 waterfall 监听；观测起点使用真实 stream/start，不宣称测量了网络建连或完整请求排队时间。

宿主 StreamChunk 的终态在 `chunk.reason.kind`：stop、tool-calls、max-tokens、error、aborted，以及适配器可扩展值。
宿主 BlockAssembler 在缺少 finish 时返回默认 stop。因此观测器必须从实际 finish 帧取得证据，不能用默认值伪造成功。
API 文档中的 length/tool_calls/content_filter 是另一层协议字段，不直接当作宿主字段。

真实模型最小探针已收到 request/header → request/context → start/chunk → assistant/message → end → turn/end。
算术题返回 94；观察到 1 次 start、27 次 chunk、1 次 end，实际路由 deepseek-account/deepseek-flash。
它验证了观测接口，不是完整 Purge 三组对照，也不证明远端模型权重版本。

## 3. Provider 归因

保存明确取得的宿主终态、错误码、HTTP 状态及用量；缺失值保持 null/unknown。
原始 Provider 原因没有公共稳定接口保证时，providerReason 保持 null，不解析整个 replayState 或日志错误正文。
不能把某个兼容网关的原因映射报告推广到官方 Provider、全部适配器或 rc.3。
过滤类终态用离线序列测试验证分类和保真，不通过重复请求改变终态。

## 4. 质量与上下文评测

复用十项固定正常任务及 host/current/candidate 对照。原始回答先做正确性检查；技术故障、取消、缺失与错误单独报告。
关键词、空文本或 content_filter 只能提供待复核线索，不能证明误拒。人工 verdict 与候选标记分开保存。
误拒率分母为已人工复核的正常任务回复，排除技术失败和取消；同时报告任务总数、采集数和复核数，避免覆盖率误导。
分类混淆矩阵以人工复核为基准；没有人工标签时留空。
用量仅统计实际取得的值，不累加重复 usage 快照；效率比较仅使用双方正确且双方指标齐全的配对样本。

工具 call/result 未配对、重复 seq、冲突事件与压缩次数只表示采集完整性问题。
正常压缩和事实摘要截断不是数据丢失证明；只有复现了实际丢失才修复上下文构造逻辑。
当前新增工作不再改变任务提示、模型策略或续跑机制。

## 5. 来源与验收边界

- [官方 Core 文档，固定提交](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/subsystems/core.zh.md)
- [官方生命周期文档，固定提交](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/agent-lifecycle.zh.md)
- [官方扩展 Cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/cookbook/extension-cookbook.zh.md)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [OR-Bench 原论文](https://proceedings.mlr.press/v267/cui25a.html)

本版不下载全量 OR-Bench，不新增付费服务。Windows 实际宿主接口探针、离线序列、CI、真实完整三组实验、页面验收和发布资产是不同证据层。
真实探针不等于生产插件升级；测试夹具不能标记为真实模型数据。未完成的验收必须在发布说明中单列。
