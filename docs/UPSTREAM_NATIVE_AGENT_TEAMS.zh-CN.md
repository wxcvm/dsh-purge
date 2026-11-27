# 原生 Agent Teams 与 Purge 红队预设集成（2026-11-20）

## 来源与范围

- 正式上游：[`CallMeGuLab/dsh-purge-safe`](https://github.com/CallMeGuLab/dsh-purge-safe)，静态基线 `d96c5f25`（v2.0.0），`lib/redteam/team-mode.js`。
- 官方宿主参考：[`deepseek-ai/deepseek-harness` Agent Teams](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/team/agent-team) 和 [Tool Agent Team](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/team/tool-agent-team)。
- 本次仅集成**官方根会话 Team 模式开关**：不新建任务表，不新增工具执行权限、审批绕过、角色限制或网络行为，不改变用户已有配置。

## 行为

官方 `agentTeams` 服务存在并提供 `isEnabled` 时，红队根会话尚无 `team/mode` 决定，插件在 `agent/created` / `agent/pre-step` 写入一次 `team/mode { enabled: true }`；用户中途通过 `agent-preset/selected` 切到红队时，等当前 Session 事件写入结束后补上。

- 通过 `ctx.inject(["agentTeams"])` 等待官方服务，旧 experimental 版本、没有 Team 服务的宿主都不写陌生事件。
- **已有 `team/mode` 绝不覆盖**，无论用户手动设为 `true` 还是 `false`；同一会话不重复注入。
- 普通、minimal、PTC 和其他预设不**主动开启** Team；红队子会话也不写。
- 普通 Session fork 的 `parentSession` 不是子代理标记；以真实 `origin` / `delegationDepth` 判断根。
- 预设切换事件用本会话递增序号淘汰过期微任务，避免红队→普通连续切换后误写。
- 可通过红队插件自身配置 `redteamTeamMode:false` 关闭自动启用。用户也可以使用宿主已有 Team 模式切换将当前会话设为 off；两种方式均不删官方任务和数据。

**注意**：官方 Team 是会话级持久状态，不是预设级状态。已在红队下开启的根会话，之后切回 standard，官方 Team 可能保持开启，除非用户在宿主将其关闭。本插件不会私自改变其现有 Team 选择。

## 与现有能力的关系

- Purge `agent-status.js` / `agent-reservations.js` 的执行中、阻塞和容量观测保持原样；不把官方任务板误算为新的 Agent 配额。
- `team_task_create/list/get/update` 是官方 `@deepseek-ai/dsh-tool-agent-team` 的条件工具，**本插件不重复注册**；只有宿主安装并启用了相应服务和工具后才可使用。
- 本次静态源码审查与 Node 单元测试可证明生命周期逻辑；CI fixture 能证明当前宿主依赖契约，但**不等于 Windows Desktop 实机中的 Team 工具已经对模型可见**。后者另需真实 UI、工具列表和任务读写证据。

## 验收样例

1. 新建红队根会话，第一轮前存在一条 `team/mode enabled:true`，工具列表出现四个官方团队工具（宿主服务和工具包已加载时）。
2. 新建普通会话，插件不自动写 Team 模式。
3. 普通→红队切换，在下一步之前自动开启；红队→普通的连续快速切换不应被过期事件误开。
4. 用户手动关闭 Team，后续 Agent 创建、每轮 pre-step 和预设切换均不重开。
5. 子代理和历史续接的普通 root fork 分别正确处理。
6. 旧宿主、缺失 Team 服务或插件显式禁用时不写 `team/mode`。

相关台账：[#347](https://github.com/wxcvm/dsh-purge/issues/347)。
