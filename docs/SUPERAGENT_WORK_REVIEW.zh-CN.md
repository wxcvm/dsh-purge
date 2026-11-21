# SuperAgent 持久任务 · 会话核对与人工恢复

> 代码入口：`lib/redteam/agent-work-items.js`、`lib/redteam/agent-status.js`、`lib/redteam/ui.js`、`lib/redteam/client.js`。当前能力是**任务台账和核对界面**，不是自动派发器。

## 在作战台使用

1. 选择靶标 → 「智能体」→「SuperAgent · 持久任务」。注册稳定的任务键、角色和目标。重复任务键不会覆盖之前的记录。
2. 在真实 Harness 会话中实际启动对应子任务，然后在任务详情中填写**宿主返回的** `session_id`、`run_id`。点击「记录已有执行」仅保存关联，不会启动智能体。
3. 页面只读读取宿主 Session/Agent 注册表，并将当前快照与最近一次绑定的 `session_id` 对照。定期手动刷新；任务历史会保留每次绑定、回报和已观察的宿主结束事件。
4. 收到匹配的 `subagent/end` 时，后端记录精确 `session_id + run_id` 的结束事件，但仍保留任务为 `running`，直到回报或人工结算。宿主没有结束事件时，必须**独立核对这次执行**并勾选确认；UI 会提交 `host_checked=true` 的人工声明，后端拒绝缺失该声明的结算，才能手动结算为 `waiting / ready / blocked / failed / interrupted`。
5. 只有 `ready` 可以经人工复核后标为 `done`；其他非运行状态可人工放弃。若需重试，先在宿主启动新执行，再绑定新的真实会话和 run；旧 run 的延迟回报不能结算新执行。

## 证据含义

| UI 提示 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| 宿主观测到同 ID 会话在运行 | 当前快照里该 session 有 active/running 状态 | 它一定在执行台账指定的 run，或任务已完成 |
| 完整快照未列出该会话 | 本次可读取的活动会话列表里未匹配 | worker 崩溃、任务中断或资源已释放 |
| 宿主注册表不可完整读取 | 有未知子会话、部分读取失败或结果被截断 | 当前没有任务运行 / 有空余名额 |
| 精确 run 的宿主结束事件 | `subagent/end` 与已绑定的 session/run 一致 | 审核完成、工具结果可信或任务可自动重试 |
| 人工标记 `done` | 任务有人确认了 ready 回报并收尾 | 外部资产漏洞已经通过独立复现 |

`agent_attention` 待阅回报、官方 Team 任务与 `agent_work_item` 持久任务相互独立。`host_checked` 只是操作者声称已核对的输入，不是宿主的独立事实。模型工具不能自行提供该声明，也不能直接关闭任务；真正的人工完成/放弃仍通过工作台。当前没有自动任务分配、超时重试、自动关单或跨进程持续调度；恢复入口只做人工关联和人工核验。隐私显示开启时隐藏任务目标、来源 ID、历史和编辑操作。

## 验证边界

- `test/superagent-work-items.test.mjs`：SQLite 多次尝试、幂等/隔离、精确事件与迁移。
- `test/superagent-registry.test.mjs`：真实注册表读取形态、状态缺失、部分/截断快照、只读对账。
- `test/superagent-work-ui.test.mjs`：界面登记/结算控制、隐私遮挡、离开页面后的异步隔离。
- `npm test` 和 `node scripts/build-client.mjs --check` 是跨平台代码质量门槛；**不代表真实 Windows 11 Desktop 验收**。

实机待补：目标 Windows Desktop 已安装插件的真实版本和加载路径；官方宿主 root/child session 的活动状态；实际子会话创建、结束、刷新、重启后的历史回显；隐私模式与高 DPI 操作；以及网络 Provider、ARTEX 双端实际连通和回执。取得截图、只读宿主日志及可复现步骤后，再更新 #343/#345/#347/#351 和发布验收记录。
