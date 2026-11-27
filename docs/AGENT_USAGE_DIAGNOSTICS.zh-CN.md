# 智能体运行成本离线诊断

基于现有运行观测 schemaVersion 1，不调用模型、网络或工具，也不修改模型行为、任务调度或计分记录。

从本机已有的运行诊断接口 `GET /dsh-purge/runtime-observations?limit=200` 保存 JSON 快照到本地 `runtime-snapshot.json`，然后运行：

```sh
node scripts/summarize-agent-usage.mjs runtime-snapshot.json > agent-usage-report.json
node --test test/agent-usage-summary.test.mjs
```

按会话 ID 统计请求数、独立的 Token 字段、流耗时、首文本时间、终态、结算状态及工具启动观测。`observedSum` 仅包含实际观测值，`observed`/`missing` 表示覆盖；无观测时合计为 null。ID 未知的记录统一列在 null 组，不认定属于同一个真实会话。

注意：观测最多保留 200 条，可能还有查询截断、淘汰或未观测记录。报告不表示完整历史，不是账单，也不能根据流耗时推导端到端时间或工具等待。实时与持久工具启动计数不得相加，不代表实际工具成功；不能从会话 ID 推断父子关系或任务成果。工具错误、重复工作和计分对账需另有脱敏的原始事件证据。仅在本机使用报告，分享前去除会话标识。

本阶段只做运行成本诊断。合成推理评测由 PR #280 独立维护；二者不代表真实模型能力已提高。真实会话数据及 Windows/Harness 验证尚未完成。
