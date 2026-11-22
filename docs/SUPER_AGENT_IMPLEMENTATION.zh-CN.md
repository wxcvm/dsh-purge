# Purge Super Agent：实施路线与验收

基线（2026-11-22）：[Purge master @2658735](https://github.com/wxcvm/dsh-purge/commit/2658735653ffc3e23a93a137b1d6ca7cb0ddb87a)，[Windows / Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44927914244)。开工时没有开放 PR。以 [#345](https://github.com/wxcvm/dsh-purge/issues/345) 跟踪宿主实测、[#347](https://github.com/wxcvm/dsh-purge/issues/347) 记录上游取舍、[#351](https://github.com/wxcvm/dsh-purge/issues/351) 记录交付状态。本页补充[总方案](CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md)，不是并行项目台账。

## 源码比较与架构取舍

| 来源 | 核对结果 | 对 Purge 的决定 |
| --- | --- | --- |
| [官方 SuperAgent 原型 @8c32a9d](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4) | [GitHub Trigger](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/sources/github-trigger.ts) 将 Issue、PR、评论、评审和 CI 转为领域事件。[Tickets](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/tickets.ts) 与 [Assignments](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/assignments.ts) 分开管理任务及运行，输入的送达和已读也分开；[Effects](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts) 与 Outbox 不和任务状态混写。 | 采用分层职责，不复制原型整套服务、数据目录、模型配置或自建执行器。只有出现需要可靠外部回执的场景才引入持久回执队列；不提前造一套通用 Effects 平台。 |
| [指定维护上游 v2.0.1 @d0a9abd](https://github.com/CallMeGuLab/dsh-purge-safe/compare/v2.0.0...v2.0.1) | tag 指向 main 当时的 HEAD。对比 v2.0.0，`team-board.js` 按根会话、项目和任务标识关联回报；`ticket-stage.js` 区分人工答复、人工验收、依赖、阻塞和结束；`orchestrator-clock.js` 的首次观测是进程内读数，不等于实际开跑或失败；`ui.js`、`client.js` 结合会话地图和运行窗口投影宿主状态。 | 吸收共享看板的关联原则、下一步提示，以及「多久未收到确认」这一诊断概念，不因超时擅自释放名额、关闭任务或重复启动。不复制模式/权限补丁；兼容问题按现有 rc.3/rc.5 契约逐项确认。 |
| [官方 Harness @2e39e70](https://github.com/deepseek-ai/deepseek-harness/commit/2e39e70496aa02986ca6a820c5d497e816b69d7e) | master 合并 0.2.2-rc.5；官方 [TeamTaskBoard](https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e/packages/team/agent-team/src/task-board.ts) 已校验前置依赖、拒绝循环，并拒绝认领被阻塞的任务。本仓库已有[官方 Agent Teams 适配](UPSTREAM_NATIVE_AGENT_TEAMS.zh-CN.md)、rc.5 夹具及独立 rc.3 回归。Team 的任务、Session 的活动和单个 run 的结束是三种证据。 | 原生 Team 服务负责实际宿主任务；保留既有适配和观测。旧宿主或注册表不可读时显示未知，不去猜测停止、容量或执行能力。 |
| Purge / ARTEX | Purge 已有 `agent_work_item`、`agent_work_assignment`、项目隔离的 SQLite 台账，`Agent Attention` 单条已阅、宿主精确 run 生命周期及工作台。[#457](https://github.com/wxcvm/dsh-purge/pull/457) 已有待阅分页；[#441](https://github.com/wxcvm/dsh-purge/pull/441) 已有 ARTEX 人工回执冲突处理。 | 不重建任务库，不把已读或宿主退出等同验收，不额外同步聊天正文或凭据。先把本地任务从开始跟到交付，再衔接外部凭证。 |

**选型：Purge 维护任务及结果，原生 Harness 提供会话、执行与真实活动证据。** 主机侧执行和后续连接器只面向普通工程任务，例如文档审阅和测试结果汇总，不把红队工具、权限绕过或攻击流程接入无人值守执行。

## 实施顺序

| 顺序 | 交付 | 验收条件 |
| --- | --- | --- |
| 1 · 先闭合成果验收 | 结果待验收后可确认完成或要求补充；反馈与原 attempt 一起保留。沿用既有登记、精确会话/run、结算、历史和人工操作。 | 文档审阅第一次缺附录 → 要求补充 → 重开数据库 → 关联第二次实际运行 → 提交补齐结果 → 人工确认完成。旧详情对新版结果的提交必须失败，查看回报不完成任务。 |
| 2 · 让工作台能解释下一步 | 采用上游共享板和会话地图的投影方式，以既有任务/运行/回报 ID 汇合，不把 Team 状态复制成第二个任务源。显示任务关系、当前人与运行、耗时、来源和未知态；提示久未收到回报而不自行判失败。对照 narrow/宽屏及隐私投影。 | 在最新 Windows Desktop 打开工作台，两个普通文档任务的等待、补充、完成与活动会话对应；切换项目、刷新、重启后无串数据。 |
| 3 · 接通普通工程任务的真实执行 | 在原生 Team 上验证计划、依赖、并行、人工接管。先完成单条真正运行，再比较独立子任务并行；已有原生能力优先。连接受任务授权的普通提示词、Skill 或个人知识引用。 | 完成一个有两项独立校对、一个依赖汇总的文档任务；只运行依赖已完成的任务，重复事件不重复启动；证据记录输出正确性、实际调用、耗时、Token 和重复工作。 |
| 4 · 处理长任务和恢复 | 区分运行中、宿主不可确认、已观察结束和可安全重试。恢复先核对已有输出和运行身份；再处理预算、暂停、有限重试与进度恢复。 | 中断后明确表明最后一条已证实事实。不重复已有结果、外部写入或消耗；长任务对照实际进展观察，而非只看计时器。 |
| 5 · GitHub / ARTEX 交付 | GitHub Issue、PR、CI、评论先只读关联到具体任务，评论是输入数据不是执行授权；引用精确提交上的 CI，重复事件只关联一次。验收后再将可公开结果人工提交，ARTEX 先复用已有手动回执和冲突处理。 | 在测试仓库走完 Issue → PR → 对应 SHA CI → 人工结果回执；不同 SHA 的成功不能代替目标 CI。ARTEX 双端验证采纳、断线和冲突不覆盖。 |
| 6 · 候选与真实验收 | Windows/Linux 源码 CI、真实 Windows Desktop/Provider、候选包与正式发布分别记录；正式版和预览不因本项目自动推进。 | 在最新候选使用自己的桌面实际复测上述常规任务，列出已通过和未验收；未经发布流程不声称已发布。 |

第 1 阶段当前代码只交付可重复的 **UI + SQLite 闭环**：新增「要求补充」保留原结果与人工反馈，复用现有等待态；不会派发、启动或重试。SQLite 重开和宿主事件夹具不等于已经在正在使用的 Desktop 上运行，真实验收仍归 #345。


第二批补齐任务详情的运行证据：打开或主动重新读取详情时，仅对该任务当前尝试单独核对宿主；异步查询期间换绑后，不把旧查询结果套到新执行。已收到该 run 的精确结束事件时，直接显示已观测结束，仍要求人工结算。界面列出核对时间、可证实的归属会话和下一步。保留清单与详情各自的读取证据；清单读到更新任务时提醒重读详情。

**真实验收前置检查（2026-11-22）**：现场官方 Windows CLI 自报 `0.2.2-rc.5`；Desktop 有活动进程，但只读探针看到的桌面 profile 插件是 `.18`，源码候选是 `.19` 且关键文件不同。没有取得候选在当前 Desktop 加载的证据，没有用旧插件冒充新版、修改活动 profile 或发送 Provider 请求。这批仅记录磁盘/进程/CLI 与回归，仍需最新版的普通文档任务实跑。


## Windows 本地文档工作台预览

`tools/superagent-preview` 可将当前 Git 提交明确列出的预览文件安装到当前 Windows 用户的 `%LOCALAPPDATA%/Purge-SuperAgent-Preview`。每次按完整提交单独放置，生成每个文件的 SHA-256。它不注册 Harness 插件、不修改 DSH_HOME、不迁入现有项目；独立数据目录在更新后保留。预览复用 Super Agent 的 SQLite 任务、尝试、精确结束和人工验收逻辑，但执行器仅为本地 Node worker。两项固定检查分别读取粘贴文本的一级标题和附录标题，各自在独立 worker 并行发起；汇总等待两个 worker 都退出，任一失败不进入待验收。工作台显示进行中步骤，历史保留两个 worker 的耗时（仅检查逻辑，不含启动时间，不能据此推断并行加速）。正文不写入任务数据库，文档检查不调用模型或联网工具。

在 Node.js 24 的 Windows PowerShell 中，从仓库根目录执行：

```powershell
$preview = node tools/superagent-preview/install.mjs HEAD | ConvertFrom-Json
& $preview.launcher -DataDir $preview.dataDir
```

打开后可用「填入示例」生成没有附录的初稿；运行后填写补充要求并退回。再次填入示例会包含附录，重新运行并确认完成。关掉浏览器不会停止后台本地进程；重新打开同一 URL 仍能看到历史。测试脚本用重开服务验证数据库恢复，不依赖真实 Provider。相同端口已有不同提交的预览时，启动器会报错而不是切回旧构建。预览没有开机自启、没有发布动作，也不代表正式 Purge 或 Harness 原生 Teams 已验收。


### 运行中断后的处理

独立预览重启后，读取不会自动重跑，也不会把入库的「运行中」当成当前活动。新版尝试带本机进程标记：原进程已不在且没有结果时，可填写依据并手动标记中断，然后重新提交正文。仍存在同一进程号只是「尚不能证实中断」，旧记录没有身份信息也不猜测。若已有精确结束事件但未结算，界面单独说明。手动标记保留原运行及原因，不添加虚假的结束事件。Markdown 正文不存入数据库，所以重跑需重新粘贴。


### GitHub 交付证据（只读）

待验收时可选填公开 PR、Issue 和需要核对的完整 SHA。只读查询 GitHub [PR](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)、[Issue](https://docs.github.com/en/rest/issues/issues#get-an-issue) 和该提交的 [Check Runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)；仅发送公开标识，不传任务正文、反馈、原始日志或凭据。读取后再次核对 PR 的 head SHA；若 PR 更新或本地任务已经被退回或验收，旧请求不会保存。公开 API 限流时保留已保存的证据，不自动用本机 GitHub 账号重试。

快照附在当次运行历史下，保留时间、精确 SHA、链接和匹配到的检查状态。空列表、不同 SHA、未完成、超出一页或非成功检查，都不会被当成成功；「返回的检查全部成功」也不证明仓库分支保护定义的全部必需检查。允许人工验收未关联 CI 的任务，不自动评论、合并、关闭 Issue 或向 ARTEX 写入。


### 手工交接给 ARTEX 知识文档

在已验收任务的「交接到 ARTEX」下载 Markdown，文件名带 SHA-256 前缀。它只包含固定检查结果、此次任务/运行的标识和验收时间，以及可选的公开 GitHub 证据；不携带原文、内部说明、原始日志、工作站路径或凭据。只有最终验收的尝试可导出。同一成果重复下载产生相同文件名与摘要。

用 ARTEX 现有的「知识文档」上传入口，在选定的目标任务下导入；不要把有任务归属的证据误放到全局库。推荐先按文件名搜索已有交接，再由操作者决定是否上传。把 ARTEX 所见的文档正文复制回预览可对照 SHA-256（只规范化 Windows CRLF 和开头 BOM）；不一致时只报告冲突，不自动覆盖任何一端。此比较证明内容一致，不证明上传成功、ARTEX 身份或双端配对，不替代既有的 SARIF 人工回执。


### 官方原生 Team 运行契约（Windows，0.2.2-rc.5）

在新的工作目录用官方 npm registry 安装精确版本的 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-headless`，三者均为 `0.2.2-rc.5`。使用 npm 正常 peer 解析，不用 `--legacy-peer-deps` 跳过宿主需要的 Cordis peer；可以使用 `--ignore-scripts`。保存生成的 package-lock。将 [官方固定提交的 team-llm.mjs](https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e/apps/cli/tests/profiles/headless/tests/fixtures/team-llm.mjs) 按原始字节放在临时目录（不要用会改换行的文本复制）。

```text
node scripts/verify-stock-harness-teams.mjs <npm-install-dir> <team-llm.mjs>
```

探针验证官方版本、CLI npm integrity、夹具 SHA-256，另建临时 HOME、DSH_HOME 与工作目录；不传递现用账号、模型密钥、日志正文或 Purge 配置。临时 profile 只将模型输出替换为上游固定夹具；真正的队友和任务状态由原生 Harness 执行。实际从持久会话日志验收：4 份会话（root、工作流子会话和两位队友）、2 个已完成的 Team 任务、2 条队友消息，前置任务完成早于依赖任务认领。脚本输出计数与证据目录，不把暂存目录当作正式安装。

同一次运行以只读方式观察真正的 `subagent/start` 与 `subagent/end`。测试夹具代替人工预先绑定任务，不加载 Purge 插件或注册工具；生产会话绑定、结束观察、SQLite 台账及工作台状态投影则使用现有代码。宿主退出后重新打开 SQLite：3 个精确运行的结束事件持久化并投影为「等待结算」，同会话下另外 3 个不同运行未被更新，没有任务被自动结算。

现用机器的 headless 配置只读检查中，含 Purge 字样的内容甚至出现在默认配置转储中；不足以作为干净官方对照，未就地执行模型。这里验收的是官方宿主与 Purge 台账代码的事件契约，**未验收当前 Desktop、完整 Purge 插件联动或真实 Provider**。
