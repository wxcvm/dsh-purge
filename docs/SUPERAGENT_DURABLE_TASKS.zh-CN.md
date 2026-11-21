# SuperAgent 持久任务账本 · 阶段一

> 状态：独立源码增量；需要 PR CI 与真实 Harness Desktop 验收，不是完整版 SuperAgent。
> 源码参考：[DeepSeek 原型](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4)、[领域模型](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/001-domain.md)、[执行恢复](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/003-execution.md)。
> 相关：[#345](https://github.com/wxcvm/dsh-purge/issues/345)、[#347](https://github.com/wxcvm/dsh-purge/issues/347)、[#351](https://github.com/wxcvm/dsh-purge/issues/351)。

## 本轮确切交付

- 每个既有演练的 assets.db 新增 agent_work_item 与 agent_work_assignment；不新建共享数据服务，不改原生 Agent Teams 的存储，也不修改 agent_attention 的已读回报。
- create 使用 task_key 幂等。assign 使用精确 session_id + run_id；同一任务多轮执行按 attempt 顺序保存。同一会话/轮次不能同时登记为另一个任务。
- report 只接受当前最新轮次且尚未结算的 assignment。重复 / 旧轮次回报只返回拒绝原因，不能覆盖新状态。
- close 是独立记录动作：只有 ready 可标 done；当前 running 必须先有结算报告。记录 done **不代表实际结果已独立验证**。
- recovery 只列出持久的 running 行；未见宿主结束事件时 host_activity 为 unverified，收到精确匹配的 subagent/end 事件后为 end-observed；机器重启本身不能证明子会话结束。没有真实宿主证据前不能自动标 interrupted、释放额外名额或重新派活。
- SQLite 事务保护每次生命周期写入；旧演练数据库按原本 DDL 自行新增空表，已有资料不重写。
- summary/objective/reason 采用原有基础敏感字符串遮蔽，**不是完整隐私匿名化**；仅存简短文本，不保存完整对话/工具轨迹。

## 现有工具示例

以上示例均仅是持久任务**记录**，不调用子智能体执行器。需要实际部署时须先有真实会话和轮次 ID。

1. redteam_work_item action=create, task_key=docs-review-01, role=review, objective=核对本地文档。
2. action=assign, task_id=返回的任务 ID, session_id=确切子会话 ID, run_id=确切轮次 ID。
3. action=report, task_id=同上, session_id/run_id=同上, status=ready, summary=已整理证据待审查。
4. action=close, task_id=同上, outcome=done, reason=已明确核对并收口。
5. 宿主中途重启后先 action=recovery，人工对照宿主会话目录和当前活动状态；如果确认旧轮次已中断，再用 action=report status=interrupted 结算旧轮次，而后 action=assign 记录新的实际轮次。

## 第二阶段：真实子智能体结束事件对账（本 PR 增量）

- 现有 `subagent/end` 钩子已通过 `agent-attention.js` 接到持久账本：先按原有预留与绑定关系找到演练，再用**精确的 `session_id + run_id`**定位之前显式登记的 Assignment。既不按任务标题模糊匹配，也不跨演练扫描 SQLite。
- 事件只在 Assignment 中写入 `host_end_at` 与白名单化的 `host_stop_reason`（completed/aborted/error/max-tokens/refusal/unknown），不自动写 `ready`、`done` 或释放额外名额。
- 没有 `redteamReport` 也可以记录真实结束事件；旧的 `redteam_attention` 仍只在有结构化回报时创建。观察账本偶发写入失败不阻止原有结构化回报收集，错误单独写诊断日志。
- `recovery` 显示 `host_activity=unverified`（还没看到真实终止事件）或 `end-observed`（宿主已发真实结束事件）。后者仍需要结算与人工核对，不能因为 `stopReason=completed` 就自行确认任务交付。
- 对**上一轮已经结束后才迟到**的事件，最多补写上一轮的宿主终止字段，不改当前任务的状态和轮次。
- 兼容正在使用阶段一旧表的测试库：`migrate()` 会给已存在的 Assignment 表补齐上述两列；不删除历史数据。

**验收限制**：本轮新增的是宿主事件的准确入账逻辑，真实 Desktop rc.5 的事件发布、会话目录与升级重启仍待独立验证。没有自动调度器、不会重复执行任务。

## 与已有模块的边界

| 模块 | 单一职责 |
| --- | --- |
| 官方 Agent Teams | 原生团队会话和团队任务板（宿主所有） |
| redteam_agent_slot / agent-reservations | 真实可观测的子会话占用与预留，不受此账本影响 |
| redteam_attention | 已结束子会话的结构化回报和人工确认 |
| redteam_task_block | 针对已有 next_action 任务键记录阻塞原因 |
| 本轮 agent_work_item / assignment | 可追溯的长任务 ID、执行轮次、终态登记和恢复候选 |

第一阶段**不会自动**调用 subagent、shell、漏洞验证、扫描、GitHub/飞书任务监听，也不会将任意历史记录当作授权。真正的 SuperAgent Source、Trigger、Eval、Ticket Engine、持久 Effects、异步投递和调度器仍未移植；不应将当前成果宣传为无人值守系统。

## 验收与待办

- 单元：重复创建、重复/乱序 report、跨库隔离、重启恢复候选、事务、状态枚举、敏感字符串脱敏、分页。
- 集成：Windows / Ubuntu Node24 测试，现有工具 inventory、客户端构建与原有用例均应通过。
- 实机：真实 Harness rc.5 中以实际 subagent 会话进行一轮创建、结束、恢复候选核对；不用伪造 Session ID。
- 下一阶段建议：在已完成的 subagent/end 精确观察记录基础上，补齐真实宿主运行状态的只读对账与待人工确认视图；核对 host-end、结构化回报、原生 Teams 状态和用户确认之间的差异。没有证据前不自动恢复或执行。
