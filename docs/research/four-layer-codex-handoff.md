# Codex 实施交接：四层运行机制与正常任务防误拒

来源：[完整深度研究](four-layer-runtime-research.md)。本文件是实施入口；原报告中的推测、引用编号、版本差异以本任务的实证核验为准。

## 目标与开始方式

在最新 beta 基础上实际实现可验证的运行观测、故障归因、上下文完整性和正常任务质量评测，保持模型输出与服务端终态原样。先读取 beta/master、开放 PR、CI、Release，特别核对 #225、#238 及已合并的任务质量评测改动（历史 #229）；不得重复开发。选择第一项尚未实现的工作立即开始，在独立功能分支提交代码、相关测试与 PR。不把研究归档 PR 当作功能完成，不要求等全部研究项完成才提交第一批代码。

## 证据与边界

- Purge beta 中 lib/obedience.js、lib/continue-retry.js、lib/index.js 已使用 agent/pre-step、agent/request、agent/request-error、agent/status、session/event 和 system-prompt/assemble；先查看最新源码与实际调用方式。
- 上游官方 [Core 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/subsystems/core.zh.md) 与 [生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/agent-lifecycle.zh.md) 记录 agent/assistant-stream；需核对安装的 0.2.2-rc.3 类型、订阅方式和事件序列，不能直接照搬新版接口。
- [官方扩展 Cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/cookbook/extension-cookbook.zh.md) 区分瞬态流式帧与持久会话事件；[架构](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/architecture.zh.md) 提供生命周期参考。
- [Discussion #11123](https://github.com/deepseek-ai/deepseek-harness/discussions/11123) 仅为特定兼容网关的错误映射报告，不证明官方 Provider 或 rc.3 存在相同问题。
- [DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion) 的 finish_reason 是协议字段，不保证宿主透传；[OR-Bench 论文](https://proceedings.mlr.press/v267/cui25a.html) 与 [数据集](https://huggingface.co/datasets/orbench-llm/or-bench) 可用于正常任务过度拒绝的评估设计。
- 本地宿主无法控制云端模型权重或服务端审核。目标是正常任务误拒诊断与可靠性，不是移除合理安全拒绝。保留原始响应与真实终态，不删除安全消息、不伪造成功、不因安全拒绝自动反复请求或切换模型；测试安全终态使用离线模拟，使用已审阅的无害任务做真实模型对照。

## P0：版本级接口核实（第一个实现任务）

- [ ] 确定实际安装的 rc.3 包版本及事件定义；定位请求、Provider、流式帧、assistant/message/assistant/attempt、工具状态和取消的真实调用顺序。
- [ ] 以最小探针确认能否收到 agent/assistant-stream 的 start/chunk/end 及真实参数；记录可用字段与事件顺序。
- [ ] 若无法取得宿主包或运行实例，明确标注未验证，保留已确认的阶段级接口；不注册猜测的 Hook。
- [ ] 在既有测试结构增加相关接口/契约测试；将版本证据写入现有兼容文档或本任务附录。

## P1：只读流式观测与 Provider 终态

- [ ] 复用已确认的事件系统，关联 session、turn、request/attempt 的真实标识；优先使用宿主提供的 ID，缺失字段明确为 unknown。
- [ ] 区分 request started、首个文本片段、工具调用、结算、失败、取消；区分 chunk、最终消息与 attempt。流式片段不是最终成功。
- [ ] 保留可取得的原始 Provider 终态、错误码和用量；正常结束、length、tool_calls、content_filter、网络失败、取消、未知分开记录。不得通过缺失文本或关键词推断服务器过滤。
- [ ] 用真实事件关联会话和请求，保证重复事件、迟到事件、并行会话、取消、插件重载不会产生错误状态。
- [ ] 只采集必要元数据，默认不持久化原始内容、提示、凭据或敏感工具参数。复用现有日志及 UI，不引入全新通用事件框架。
- [ ] 添加离线事件序列测试，包括正常流、工具调用、截断、断流、过滤终态、未知原因和取消；确认不修改事件数据和模型输出。

## P2：任务质量与误拒来源评估

- [ ] 复用现有 scripts/evaluate-task-quality.mjs（先确认最新分支位置），扩展明确标注的无害任务样本与结果类别；区分正确完成、错误、缺失、误拒候选、技术故障、未知。
- [ ] 设计固定任务集、同模型/参数的对照组；样本标签人工核对，不因出现拒绝关键词或 content_filter 就认定误拒。
- [ ] 记录任务正确完成率、误拒率（分母仅正常任务）、分类混淆矩阵、首片延迟、总耗时、Token 用量；缺失字段不编造。
- [ ] 先离线模拟和本地模型，真实云端请求只在已有可用环境和额度内进行。若无法执行，提交可复现脚本及真实缺口，不报告虚构指标。

## P3：上下文与清洗台状态整合

- [ ] 查找正常任务中的上下文丢失、重复消息、工具结果遗失、压缩后任务约束不一致；仅修复有证据的上下文/状态问题，不变更模型安全策略。
- [ ] 将已实证的状态、Provider/模型、首片延迟、终态、错误与任务质量结果接入现有清洗台，复用现有页面和数据流；高频事件合并更新。
- [ ] 完成 Windows Desktop 宿主验证与必要测试，记录已确认支持的版本与未确认环境。发布沿用既有预览版流程，不擅自新增发布门禁。

## 交付约定

每轮先查并行改动；优先根因、最小必要改动和相关测试，不新增依赖或付费服务。首个功能 PR 应给出实际源码差异、测试结果、rc.3 证据与剩余问题。研究文档 PR 可先合并，但不等于功能完成。真实运行验证与发布应独立记录。