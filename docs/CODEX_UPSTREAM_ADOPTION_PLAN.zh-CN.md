# Purge 接手版上游吸收 · Codex 可执行总方案

> **2026-11-20 源码/任务快照**。维护仓库 [wxcvm/dsh-purge](https://github.com/wxcvm/dsh-purge)，默认分支 `master`。本文是**任务导航与执行方案**，不是“全部已完成”声明，也不代替当前 GitHub PR、CI、Release 和实机验收记录。
>
> **Codex 先读**：仓库根目录 [`AGENTS.md`](../AGENTS.md) → 本文 → [#347 接手版/社区上游追踪](https://github.com/wxcvm/dsh-purge/issues/347) → [#351 全项目总台账](https://github.com/wxcvm/dsh-purge/issues/351)。随后检查最新 `master`、未合并 PR、CI 和目标文件；旧文档中的 commit SHA 和技能数量都是当时的快照，不能替代最新核查。

## 0. 开工前实时核对与首轮工作（2026-11-20）

**先读本节和第 7 节，再查相应专题。** 以下为 [master@0bd3a58](https://github.com/wxcvm/dsh-purge/commit/0bd3a58ba1981c61193e898a2d1ba4f3517d7f5d) 的任务快照（[Windows/Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44724659602) 均成功）；仓库可能继续变化，以当前 GitHub/本地 `origin/master`、PR 状态与对应提交 CI 为准。

| 模块 / 原 PR | 2026-11-20 已核对情况 | 不要做的重复工作 / 下一步 |
| --- | --- | --- |
| [#382/#383 提示词](https://github.com/wxcvm/dsh-purge/pull/383)、[#384 Team](https://github.com/wxcvm/dsh-purge/pull/384) | 已合并 | 不重建路由/Team；真实 Windows Desktop 和 Provider 仍需独立验收 |
| [#385 Agent attention](https://github.com/wxcvm/dsh-purge/pull/385) | **已合并**、[Windows/Linux CI 通过](https://github.com/wxcvm/dsh-purge/actions/runs/44646881605)，当前数据表名 `agent_attention` | 不重写已合并的回报/ack 后端。剩余是 [#343](https://github.com/wxcvm/dsh-purge/issues/343) 智能体待办 UI、真实 `subagent/end` / 用户界面闭环。PR 描述较早写 `agent_report`，不是最新代码 |
| [#386 LLM 最终请求](https://github.com/wxcvm/dsh-purge/pull/386) | 已合并；测试在隔离官方 Agent Loop 到达**惰性模拟适配器** | 不重造冻结请求测试；仍缺真实网络 Provider 与用户实际 Desktop |
| [#387 版本区间](https://github.com/wxcvm/dsh-purge/pull/387) / [#391 同资产精确 CVE 历史排序](https://github.com/wxcvm/dsh-purge/pull/391) / [#392 本地 PoC URL CSV 索引](https://github.com/wxcvm/dsh-purge/pull/392) | **均已合并**，从已关闭归档的 [#378](https://github.com/wxcvm/dsh-purge/pull/378) 分拆、修正并通过各自 Windows/Linux CI | #378 仅审真正未移植的独有内容；**不要再整包引入版本区间、模糊 CVE 历史、PoC 目录写入或自动执行功能** |
| [#388 质量采集](https://github.com/wxcvm/dsh-purge/pull/388) | 已合并，从已关闭归档的 [#254](https://github.com/wxcvm/dsh-purge/pull/254) 选择性吸收 | 旧 #254 以 `beta` 为目标，不可整包合并旧客户端/旧知识模块；真实模型三组验收未完成 |
| [#389 沙箱审批](https://github.com/wxcvm/dsh-purge/pull/389)、[#390 Windows PowerShell 工具](https://github.com/wxcvm/dsh-purge/pull/390) | 已合并隔离宿主/Runner 回归 | 不视为用户 Windows Desktop 上 `sandbox_permissions` / 空 `justification` 的真实问题已解决，见 #355 |
| [#376 rc.5 CI 夹具](https://github.com/wxcvm/dsh-purge/pull/376) | 已合并，官方 rc.5 默认夹具 / rc.3 独立回归 | [旧 ETARGET 已证实可由 stale npm 索引复现](https://github.com/wxcvm/dsh-purge/pull/376#issuecomment-7027708270)；不要重开或混配版本。夹具和 CI 不证明真实 Desktop / Provider |

**当前交付边界**：[#402](https://github.com/wxcvm/dsh-purge/pull/402) 已合并，最新可见 [`v1.1.92-wxcvm.18`](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.18) 指向 `0bd3a58`。Release、后续 master、Windows Desktop 和网络 Provider 分开核对。CI 用 Node **24**，常规使用 `npm test` 和 `node scripts/build-client.mjs --check`；`test-pending` 不是正常 CI 的必绿门槛。

**只读启动命令**（前提是已有授权的仓库克隆，不能在有未提交改动时盲目 reset/clean）：

```sh
git status --short --branch
git fetch origin
git log -1 --format='%h %s' origin/master
gh pr list -R wxcvm/dsh-purge --state open
gh issue view 347 -R wxcvm/dsh-purge
gh issue view 351 -R wxcvm/dsh-purge
```

若没有 `gh`、GitHub 授权或远程工具，先报告访问缺口，继续可执行的本地检查；**不要猜最新 PR 状态**。根目录 `AGENTS.md` 存在于 Git 仓库，但不在当前 npm package 的 `files` 白名单内；仅拿到发行 ZIP 或安装好的插件，不一定拥有完整交接文档。

## 1. 关系与决策（不要混同）

1. 原始 Purge 历史署名：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)；本仓库保留 LICENSE/NOTICE。**2026-11-20 GitHub API 对该历史 URL 返回 404**（可能私有、迁移或下架，不推定其不存在）。不能将此 URL 当作当前可直接拉取的上游；现用可访问的接手版固定 SHA 与我方源码核查。
2. **指定重点维护上游 / 本轮主要差异来源**：[CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe)；用户已明确选择将它作为未来优先跟踪对象。已审查基线：[`main@d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec`](https://github.com/CallMeGuLab/dsh-purge-safe/tree/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec)（上游 v2.0.0、文档描述目标 DSH 0.2.2-rc.3）。后续源码已对照 [`main@cc881fbd`](https://github.com/CallMeGuLab/dsh-purge-safe/commit/cc881fbd68b891772330c6b0d275b0c971794e00)，新主题提交不属于旧 v2.0.0 制品。
3. 官方宿主：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；**Harness API/真实服务事实以目标宿主源码与运行时为准**。其中 [Agent Teams](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/team/agent-team)、[Team 工具](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/team/tool-agent-team)、[流式接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md) 属于独立权威依据。
4. “作为上游”指**持续比较、记录出处和有选择吸收**；**不意味着**改 Git remote、自动同步、覆盖我方完整源码、默认启用所有功能或改变发布频道。不是把继任关系当作已被 GitHub 独立核实的授权凭证。
5. 其他社区项目是**借鉴来源，不等同直接上游**；逐项核对许可证、当前实现、与我方重合/缺口及真实价值。用户偏好**零新增付费、最小充分实现、只修改根因、避免附加功能门禁与冗余审计**。

## 2. 已有基线——先验证，别重复造

| 范围 | 已进入 master 的内容 | 证据 / 当前边界 |
| --- | --- | --- |
| 主提示词路由 | 按预设/模型/会话与来源判断的已有规则引擎 | [PR #330](https://github.com/wxcvm/dsh-purge/pull/330)、[Issue #340](https://github.com/wxcvm/dsh-purge/issues/340)；不新造 router |
| 接手版密封默认提示词作为**可选备用** | 显式手动切换、默认关闭、保留主方案及自定义提示词 | [PR #382](https://github.com/wxcvm/dsh-purge/pull/382)、[`UPSTREAM_SAFE_PROMPT_BACKUP`](UPSTREAM_SAFE_PROMPT_BACKUP.zh-CN.md)；**真实 Provider 投递未因此验收** |
| 主/备切回兼容 | 恢复原生 persona-prefix 的 `order`/`interpolate`、移除合成空段；报告 source readiness | [PR #383](https://github.com/wxcvm/dsh-purge/pull/383)；模板变量 `{{cwd}}` 不应被破坏 |
| 红队官方 Team 模式 | 官方 `agentTeams` 可用时在红队**根会话**启用；不覆盖用户手动 off | [PR #384](https://github.com/wxcvm/dsh-purge/pull/384)、[`UPSTREAM_NATIVE_AGENT_TEAMS`](UPSTREAM_NATIVE_AGENT_TEAMS.zh-CN.md)；**四项工具的 Desktop 可见性/读写仍待实机** |
| Agent 运行与占用 | 已有 `agent-status`、`agent-reservations`、`task-context`、`task_block`、持久 handoff 摘要 | [源码](../lib/redteam/agent-reservations.js)、[Issue #345](https://github.com/wxcvm/dsh-purge/issues/345)；不要复制另一套任务/并发账本 |
| 统一知识/技能、ARTEX 联动和已有 UI | 已有来源适配、分页、项目/资产/证据、状态接口 | [社区吸收记录](COMMUNITY_ABSORPTION_20261119.zh-CN.md)、[#344](https://github.com/wxcvm/dsh-purge/issues/344)、[#346](https://github.com/wxcvm/dsh-purge/issues/346)；新来源不要重建数据库 |

**历史 PR 去重**：#376 已合并，#378/#254 已拆分归档；#396 已由 #401 替代，#399 已由 #398 替代，#368 已由 #374 替代，不重开旧分支。

## 3. 按原始上游源码逐项吸收（有明确文件入口）

以下链接固定到上游 `d96c5f25`，可直接供 Codex 打开，避免后续 `main` 更新使任务含义漂移；追新提交时另查 [上游 commits](https://github.com/CallMeGuLab/dsh-purge-safe/commits/main) / [releases](https://github.com/CallMeGuLab/dsh-purge-safe/releases)。

| 顺序 | 上游原始源码/方案 | 我方落点或待办 | 执行判断 |
| --- | --- | --- | --- |
| A · 已合并 | [`lib/identity.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/identity.js)、[`lib/asset-table.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/asset-table.js) | [`lib/upstream-safe-prompt.js`](../lib/upstream-safe-prompt.js)、[`lib/upstream-safe/asset-table.js`](../lib/upstream-safe/asset-table.js)，PR #382/#383 | 只导入默认提示词备份和组装适配，遵循现有路由；**不从上游批量复制 tool-gate/subagent-control** |
| B · 已合并 | [`lib/redteam/team-mode.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/team-mode.js) | [`lib/redteam/native-team-mode.js`](../lib/redteam/native-team-mode.js)，PR #384 | 只启用宿主官方 Team 模式；不要重复注册 `team_task_*`、覆盖已有 `team/mode` |
| C · **代码已合并、实机/界面待验收** | [`lib/redteam/tools.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/tools.js)、[`store-core.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/store-core.js)、[`schema.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/schema.js) | PR #385：新的 `agent_attention` **表位于已有靶标 SQLite**；`redteam_attention(action=list\|ack)`、`subagent/end` 报告解析、精确 `report_id` 确认 | 上游 `agent_report` 与我方表结构不同，**不能直接共用表名**；旧报告不能因确认新报告而重新出现；无结构化信息不能凭空推断 waiting |
| D · 暂不导入停泊算法 | [`lib/redteam/slot-state.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/slot-state.js) | 我方 [`agent-reservations.js`](../lib/redteam/agent-reservations.js)、[`agent-status.js`](../lib/redteam/agent-status.js) | **waiting/blocked 是回报，不证明宿主已释放真实运行资源**；不把 “parked” 从已观察 running 里直接扣除。free 未验证时维持 unknown/null |
| E · 下一批 | [`lib/redteam/bootstrap-runtime.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/bootstrap-runtime.js)、[`kev.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/kev.js) | #344/#360：与现有 Nuclei 模板搜索、CVE / KEV 来源管理比对 | 补增量仅在缺口存在时做；优先**状态可见 + 显式手动刷新**，避免照搬启动时 `download:true, background:true` 造成隐式联网 |
| F · 下一批 | [`lib/redteam/tools.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/tools.js) 内 `redteam_batch`、`redteam_cleanup` | #352/#345：检查我们现有批量导入、任务记录去重与清理入口 | 先对比数据主键/事务/幂等/删除实际影响；只移植缺失能力，不建立第二套批处理引擎 |
| G · 下一批 | [`lib/redteam/client.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/client.js)、[`lib/ui-fullscreen.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/ui-fullscreen.js)、[上游预览图](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/docs/preview/dock-clean.png) | #343/#352/#364/#361：作战台概览、Agent 待办 UI、清洗台信息密度、全屏及点击热区 | 界面按人类使用路径归类；不整包替换 `client.js`，截图不是当前 Desktop 可运行证据 |
| H · 持续对照 | [上游 `skills/redteam/`](https://github.com/CallMeGuLab/dsh-purge-safe/tree/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/skills/redteam)、[`redteam-superagent-dev.md`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/docs/redteam-superagent-dev.md) | #344/#302：技能及知识库文件级差异；核对 Team 能力与设计稿 | 旧快照上游 40 / 我方 47 份 Markdown 的同名/独有差异仅供检索起点；**上游超代理 agent_task 设计稿不代表已实现** |
| I · 独立评估 | [`lib/tool-gate.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/tool-gate.js)、[`lib/subagent-control.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/subagent-control.js) | #337/#341/#342/#355：与当前 Harness 的执行/审批/Provider 行为核对 | 存在大范围交互语义变化风险；**不作为提示词/Team 引入的隐含依赖**。发现真实缺口再提针对性方案 |

## 4. Codex 后续实施队列（逐项做完才更新状态）

### P0. 先验证真实宿主请求与发布链（优先于宣称“已修”）

- **目标**：确认真实 Windows Desktop + 指定 Harness 版本下，Purge 当前加载的是哪个代码、补丁实际是否有效、Provider 收到的最终 System Prompt 是否符合预期。
- **位置**：[#336 安装/回退](https://github.com/wxcvm/dsh-purge/issues/336)、[#337 应用→重启→重连](https://github.com/wxcvm/dsh-purge/issues/337)、[#339 pack 合约](https://github.com/wxcvm/dsh-purge/issues/339)、[#340 提示词](https://github.com/wxcvm/dsh-purge/issues/340)、[#341 流式](https://github.com/wxcvm/dsh-purge/issues/341)、[已合并的 #386 惰性 Provider 请求测试](https://github.com/wxcvm/dsh-purge/pull/386)及[已合并的 #376 rc.5 fixture](https://github.com/wxcvm/dsh-purge/pull/376)。
- **核验链**：`source-readable → router-selected → assembled → official rendered → frozen llm/stream request（#386 已有隔离夹具）→ 实际 Provider 网络请求（仍未验收）`。分别记录宿主版本、活动 Profile/插件版本、重启后加载路径和实际请求结果。**冻结请求、惰性适配器和真实 HTTP 投递不等价**。
- **矩阵**：红队/普通/minimal/自定义预设 × 主/备用切换 × 有/无 `{{cwd}}` 插值 × 用户全局/局部开关与 Session 锁定 × 子代理/根会话。逐案验证只注入一次、原生上下文/工具保留、无额外默认启用。
- **完成标准**：真实宿主的只读证据、前后对照、相应测试、明确的未测 Provider 列表；不要仅凭 CI、UI 显示或旧版安装包称完成。

### P1-A. #385 已合并后的 Agent 待办 UI 与实机闭环

- **先做**：以 master 已合并的 [PR #385](https://github.com/wxcvm/dsh-purge/pull/385) 的 `agent_attention` 表、`redteam_attention` 工具、`subagent/end` 捕获为起点；专注尚未验收的 UI、会话关联与真实宿主行为，**不要重做/再合并后端**。PR 早期正文仍写 `agent_report`，属于改名前过时描述，以最新源码为准。
- **数据模型**：原有靶标 DB 中的 `agent_attention` 与上游 `agent_report` 分开；字段仅存来源子会话、root/run ID、状态、必要摘要与 `acknowledged_at`，不复制完整用户/助手消息。保持用户编辑的原有角色稿不被自动覆盖。
- **事件**：在 `subagent/end` 记录有结构化 `redteamReport:` 的最后消息；对同一 run 幂等，未命中则不假装存在回报；异常不阻断当前预留释放。
- **工具/界面**：`redteam_attention list/ack` 返回当前靶标最新未处理回报、来源、所需资源；作战台「智能体」页增加可直接查看/确认的卡片，显示 waiting/blocked/ready 与“尚未观测”区别，避免只有 JSON。**点击确认只处理对应 report_id**，不自动视为资产验收。
- **最小测试**：旧上游表共存、两靶标隔离、重启后复现、重复事件、快速连续报告、旧报告不复活、无凭据泄漏、无假空闲、UI API 保存与刷新；真实宿主首次子任务结束到页面可见需端到端检查。
- **关联**：[#347](https://github.com/wxcvm/dsh-purge/issues/347)、[#343](https://github.com/wxcvm/dsh-purge/issues/343)、[#345](https://github.com/wxcvm/dsh-purge/issues/345)。

### P1-B. 官方 Agent Teams 与任务效率

- 对 [PR #384](https://github.com/wxcvm/dsh-purge/pull/384) **只做实机补证**：确认 `team/mode`、官方 `team_task_create/list/get/update` 在真实红队根会话可用；检查普通预设、手动 off、会话 fork、快速预设切换、子 Agent 的隔离。
- 与现有 `task_context` / `agent-reservations` 的身份对应仅做关联显示；官方 Team 任务和本地证据/待办是不同含义，不做双写任务表。用真实完成/重复派发/Token/等待时间对照评估是否真的更有效；见 #345。
- 已存在 [PR #291–#294](https://github.com/wxcvm/dsh-purge/pulls?q=is%3Apr+is%3Aopen+%22qa%22) 等模型质量实验，先去重其范围；不得凭模拟结果声称真实模型工作有效。

### P1-C. 清洗台/演练台操作体验

- 已有缺口和设计入口：[#343](https://github.com/wxcvm/dsh-purge/issues/343)、[#352](https://github.com/wxcvm/dsh-purge/issues/352)、[#361](https://github.com/wxcvm/dsh-purge/issues/361)、[#364](https://github.com/wxcvm/dsh-purge/issues/364)。应核查现有页面各模块的导航归属、总览信息、保存后回显、展开折叠默认、点击热区、Windows 大片空白、全屏与滚动。
- 让总览能回答“是否配置完整/哪些环境可用/正执行什么/哪些未执行/需要我处理什么”；**进度条的分母与含义必须真实**，将未尝试、失败、等待重启、已执行但未验证区别显示，不把“未执行”含混标记成不可运行。
- 注意 `lib/redteam/client.js` 与构建产物 `client.js` 的真实来源；测试前确认修改的是有效源码/生成链，而不是只改了不加载的副本。
- 验收不只看静态 mockup：真实 Desktop 交互、重启后保存、Windows DPI/缩放、页面加载错误及用户能实际完成的动作均需对账。

### P1-D. 全局/局部提示词与流式诊断

- [#340](https://github.com/wxcvm/dsh-purge/issues/340)：独立全局和多份局部编辑框；每条分别保存、启停，绑定模型/会话/预设；每条独立黑白名单开关、条目和命中原因；多份稳定顺序合并；红队不污染普通会话。先读已合并 #330 和 #382/#383；**不要重新建立平行路由系统**。
- [#341](https://github.com/wxcvm/dsh-purge/issues/341)、[#342](https://github.com/wxcvm/dsh-purge/issues/342)：区分只读观察、界面显示和 `llm/stream` 真正可变更的流水线；处理取消、半截输出、重复/乱序及拒答识别误报；是否值得加可选 Hook 先在无副作用用例证明收益。不能把改了屏幕文本当作 Provider 已执行工具动作。
- [#355](https://github.com/wxcvm/dsh-purge/issues/355)、[#356](https://github.com/wxcvm/dsh-purge/issues/356)：参数名和宿主工具协议对账先于无依据的全局改写。

### P1-E. Nuclei/KEV、批处理和知识来源

- [上游模板管理](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/bootstrap-runtime.js) / [KEV 缓存](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/kev.js)：对照我方现有 CVE / Nuclei / AboutSecurity / ARTeX 检索来源，选择最小的可观察“版本、路径、更新检查、手动刷新、离线错误”功能；不要为了看状态默认下载整个模板库或私自启动长期任务。
- [上游工具集合](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/tools.js)：逐函数比较 `redteam_batch` / `redteam_cleanup` 与我方资产导入、证据和清理入口；有独有收益才做事务化增量，写操作应返回每条结果及可核对的原始记录键，不能自动删除历史资产与证据。
- [#344](https://github.com/wxcvm/dsh-purge/issues/344)：知识/技能 **按来源去重 + 保留可追溯引用 + 只吸收增量**；参考 [社区吸收记录](COMMUNITY_ABSORPTION_20261119.zh-CN.md)。小模型路由研究 [#350](https://github.com/wxcvm/dsh-purge/issues/350) 是**可选**，不作为该链路依赖。

### P2. 跨仓协作和发布

- [#346 Purge ↔ ARTEX](https://github.com/wxcvm/dsh-purge/issues/346) 与 [wxcvm/ARTEX](https://github.com/wxcvm/ARTEX)：建立两端明确的公司/任务/资产映射、增量回执、幂等/冲突恢复；不凭名称强行合并记录。现有可用桥接先保留。
- [#338](https://github.com/wxcvm/dsh-purge/issues/338)、[#339](https://github.com/wxcvm/dsh-purge/issues/339)、[#336](https://github.com/wxcvm/dsh-purge/issues/336)：真发版前核对原有本机接口、实际打包清单、干净 `DSH_HOME`、Windows 安装/恢复；新功能不自动要求上线、付费或增加云依赖。
- [#351](https://github.com/wxcvm/dsh-purge/issues/351) 继续作为全项目总路线图，当前文档是 **#347 的执行明细**，不另开总台账。

## 5. 其他已知原始链接（与直接上游分开）

**社区 Purge 变体 / 技能来源：** [ZiDuNet/dsh-purge](https://github.com/ZiDuNet/dsh-purge)、[kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge)、[dongliuwuzhong-arch/DSH-purge](https://github.com/dongliuwuzhong-arch/DSH-purge)、[realMisakaMikoto/dsh-purge](https://github.com/realMisakaMikoto/dsh-purge)、[555bbbAAA/dsh-purge](https://github.com/555bbbAAA/dsh-purge)、[lzzzz666888/dsh-purge-optimized](https://github.com/lzzzz666888/dsh-purge-optimized)、[Minggle/dsh-purge-skills](https://github.com/Minggle/dsh-purge-skills)、[yaklang/hack-skills](https://github.com/yaklang/hack-skills)、[yaklang/yak-skills](https://github.com/yaklang/yak-skills)。

**跨项目启发（不是代码直接上游）：** [CyberStrikeus/CyberStrike](https://github.com/CyberStrikeus/CyberStrike)、[AntiFox-AI/antifox](https://github.com/AntiFox-AI/antifox)、[usestrix/strix](https://github.com/usestrix/strix)、[vxcontrol/pentagi](https://github.com/vxcontrol/pentagi)、[GreyDGL/PentestGPT](https://github.com/GreyDGL/PentestGPT)。Mojin/富江等历史资料已归入 [#347](https://github.com/wxcvm/dsh-purge/issues/347) / [#344](https://github.com/wxcvm/dsh-purge/issues/344) / [#302](https://github.com/wxcvm/dsh-purge/issues/302)；在没有核实代码仓库唯一 URL 时**不凭项目俗称猜链接**。跨项目许可证可能与本仓库不同，先查实际 `LICENSE`。

**本仓库文档原始入口：** [提示词备份](UPSTREAM_SAFE_PROMPT_BACKUP.zh-CN.md) · [原生 Teams](UPSTREAM_NATIVE_AGENT_TEAMS.zh-CN.md) · [社区差异](COMMUNITY_ABSORPTION_20261119.zh-CN.md) · [工具逐项说明](drill-tools-reference.md) · [当前运行观测](RUNTIME_OBSERVATIONS.zh-CN.md) · [版本中心](RELEASE_CENTER.zh-CN.md)。

## 6. 实施与状态更新约定（Codex 工作流提示，不增加新门禁）

1. **读完再改**：先 `git status`，比较实际 `master` 与开放 PR，检查相关 issue、上游固定 SHA 的源文件和现有测试；不要把已合并功能重新做一遍。检查目标 GitHub 仓库与当前工作区有访问权限。每个功能补丁只使用其真实来源和兼容接口。
2. **每轮一个焦点**：修复根因 → 最小相关代码 → 必需测试 → CI/宿主检查 → 在对应旧 Issue / PR 贴结果。与并行 Codex/DSH 产生冲突时优先小范围合并，不覆盖他人的未提交更改。
3. **状态五分法**：`提议`、`代码已提交`、`已合并且对应 CI 通过`、`真实 Desktop/Provider 已验收`、`已发布`。状态变化只根据可打开的提交/PR/CI/安装证据更新；各阶段不互相替代。
4. **执行目标范围**：不擅自增加功能黑名单、并发上限、批准步骤或服务依赖；真实宿主既有规则与权限不因吸收外部代码而暗中改变。若确实需要改变既有用户行为，先写出缘由和影响范围。
5. **交接更新位置**：具体源码差异、下一步补丁写回 [#347](https://github.com/wxcvm/dsh-purge/issues/347)；全项目进度在 [#351](https://github.com/wxcvm/dsh-purge/issues/351)；涉及的既有 #340/#343/#344/#345/#346 等按模块补充。每条说明包括**原始链接、代码路径、问题、推荐方案、完成条件、PR/CI 与未验证项**，不新开一套重复事项。
6. **同步校验**：新增或更新文档链接后，确认文件已在默认分支；原始上游 commit 链接可打开；任务引用没有标成不真实的“完成”。文档改动本身**不**代表 CI 或 Desktop 验收。

## 7. 总计划及专题进度

本表同时覆盖 #347 与 #351。状态为**已具备、已合并待实机、确认缺口、待对账、仅设计/可选、明确不移植**，不是发布或实机完成清单。以专题收尾；同专题可以拆几个小 PR，独立任务可以并行。

| 轮次 | 专题 / 归属 | 交付与验收 |
| --- | --- | --- |
| 0 | #347 / #351 入口与去重 | 更新双仓固定 SHA、开放 PR、已合并/替代证据和最新 Release；本表与已有社区来源表互补，不新建平行台账。实施从新工作树起步，保留现有工作树。 |
| 1 | #336/#337/#339/#244/#348 制品、环境与恢复 | 同一候选 SHA 分别实打 npm tgz 与 Git ZIP，检查文件、包内版本、入口与 SHA-256；验证干净加载、更新中断、现有配置样本的升级、回退及重连；版本顺序覆盖 beta.9/beta.10 与渠道隔离。准备真正隔离的 Windows Desktop（独立 Electron 数据目录、DSH_HOME 和实例或独立 VM），分别记录 Web、Headless、Runner。保留 rc.3/rc.5 合约。 |
| 2 | #338/#340/#341/#342/#355/#356 配置、诊断与接口 | 用普通无害样例核对配置保存、当前进程、实际加载路径、本机请求、取消/乱序/重复/终态；确认已具备的兼容能力不重做。验收本机鉴权、旧数据迁移、日志/备份脱敏和凭据分离；参数说明与结果检查用无副作用输入，不修改审批。真实远端 Provider 仅用隔离测试配置，单列验收。 |
| 3 | #343/#345/#302 Super Agent | 在已合并 #384/#385 上补人工待阅、来源、逐条确认与可靠错误回显；不接自动派发。普通文档任务核对来源/run、重启、重复工作和同条件指标；现有 Teams、报告、占用与完成态分开。持久任务、交接、恢复、复盘登记为设计，实测不足才进入普通任务实现。 |
| 4 | #343/#352/#361/#364 交互与窗口 | 修全屏晚到、外层页签键盘语义和局部主题解析，保留 #401。总览/异常入口、保存/草稿、窄窗/滚动与焦点按真实操作验收；#364 独立查大块空白和绘制，记录 DPI、窗口态、构建身份，不由异步全屏测试代替。 |
| 5 | #344/#352/#360 人工资料、技能与环境 | 逐项核对人工批量导入预览、逐行结果、证据来源与归档恢复；复用现有事务及存储，不建平行账本。核对知识正文、稳定 ID、分页、引用、失效状态、技能宿主注册和按需更新/移除；环境只读版本与何时实测分开。CISA KEV 只是可选 CVE 公告来源，先核实缺口，不自动下载，不改变单资产状态。 |
| 6 | #346/#336 与 ARTEX #172/#180/#183 双端交付 | 保留公司绑定、手工交接与只读回执，明确公司/任务/资产配对、来源、版本和幂等性；覆盖过期、断线、权限变化与冲突，保留人工复核。真实 Windows 双端分别验收发现、采纳、升级和回退，不扩令牌权限或覆盖最终结论。 |
| 7 | #347/#302/#344 与 ARTEX #183 来源裁定 | 固定主上游提交，并以第 5 节的现有社区表为底：逐源登记版本、许可、来源、已具备/待验收/真实缺口、接收仓库及证据。补历史原仓及 Mojin、富江、REA 等项目，未核实地址保留待证。可独立取用的增量回填各专题；不移植无人值守攻击与保护规避链路。 |
| 8 | #349/#350/#348 版本中心与远期研究 | 对照版本中心、开发状态、发布资产及历史归属。保留历史与现行署名、有效标签和可选 paper-autopilot；不自动提升频道或发布。#350 为规则优先的可选研究：仅用普通样本比较准确性、延迟和资源，未证实收益不集成。 |

**已补证的基线（.18）**：发布 ZIP 与 SHA256SUMS 已核对；#244 的跨位数与稳定渠道已由现有 Node 24 回归证明，不需要另写比较器。#337 的 Windows 合成普通目录与 pnpm junction 回滚通过，不等于当前桌面安装已升级或重启。当前在用的 Windows Harness 是 rc.5；已读清单并用实际安装树的工具编译器跑隔离契约，未启动或修改该实例。真正的 Desktop 独立实例、隔离远端 Provider 和双端 ARTEX 仍分别需要验收。

**共同验收**：独立记录源码、同一候选 SHA 的 CI、合并、真实 Desktop / Provider / 双端、Release。没有独立测试账号或实机时写明实际缺件和复跑条件，不把夹具写成真实宿主。不要复制现有凭据，不启停正在使用的安装，不新增付费调用。每轮结果回填对应旧 Issue，#347 汇总来源裁定，#351 汇总交付状态。

## 8 · 版本中心、发布证据与远期研究

2026-11-21 对账基准：[Purge master @59df66b](https://github.com/wxcvm/dsh-purge/commit/59df66b8ec3b1ba7cc883860a057287dc9910d0d)、[指定上游 @d0a9abda](https://github.com/CallMeGuLab/dsh-purge-safe/tree/d0a9abda6e2eb020dde85b48b5727b45d26582a7)、[ARTEX main @c972402](https://github.com/wxcvm/ARTEX/commit/c97240287eb2da6d660707cae5b8000bfec17ff0)。Purge 查验开始时无开放 PR；以下以固定提交、已合并 PR 和实际下载资产为准，不能当作未来最新值。

| 项 | 已交付或已取得的证据 | 仍缺的验收或采纳决定 |
| --- | --- | --- |
| 0 · 入口与去重 | [#376](https://github.com/wxcvm/dsh-purge/pull/376) 已合并，保留原 rc.3/rc.5 合约；[#429](https://github.com/wxcvm/dsh-purge/pull/429) 已吸收前期提示词和 Super Agent 分支。三仓固定 SHA 已重查；GitHub 当前可见性为公开，首页移除过时的私有说明，保留历史记录、LICENSE 和 NOTICE。 | 不复开 #378/#254 或已替代 PR；不改标签、发布频道或仓库可见性。 |
| 1 · 制品、环境与恢复 | [#428](https://github.com/wxcvm/dsh-purge/pull/428) 的清单检查和 [713d260](https://github.com/wxcvm/dsh-purge/commit/713d260) 的 Windows/Ubuntu 打包安装通过；[版本中心](RELEASE_CENTER.zh-CN.md) 分开记录两份已发布 ZIP、当前源码与本机 rc.5 安装。磁盘插件同为 .18，不是探针比对的主线版本 `748192d` 的字节。 | 独立 Windows Desktop/Web 上的真实安装、升级、中断回退、重启/重连，继续跟踪 [#336](https://github.com/wxcvm/dsh-purge/issues/336) / [#337](https://github.com/wxcvm/dsh-purge/issues/337)。 |
| 2 · 配置、诊断与接口 | [#429](https://github.com/wxcvm/dsh-purge/pull/429) 的普通提示词改进和 [8a65c77](https://github.com/wxcvm/dsh-purge/commit/8a65c77) 的当前轮原生消息匹配已在主线。主/备开关、模型/会话作用范围与“已组装/已投递”分开；本机鉴权回归通过（[#427](https://github.com/wxcvm/dsh-purge/pull/427)）。 | 未在隔离真实宿主做保存重启、取消/乱序实测或 Provider 请求比对；不能从 UI 判断投递，见 [#340](https://github.com/wxcvm/dsh-purge/issues/340) / [#341](https://github.com/wxcvm/dsh-purge/issues/341)。 |
| 3 · Super Agent | [#422](https://github.com/wxcvm/dsh-purge/pull/422) 区分宿主结束与人工确认；[#429](https://github.com/wxcvm/dsh-purge/pull/429) 的独立待阅页和逐条确认在主线，复用既有报告与占用。 | [#343](https://github.com/wxcvm/dsh-purge/issues/343) / [#345](https://github.com/wxcvm/dsh-purge/issues/345) 仍需无害文档任务从宿主结束到单条确认及重启后的完整读回；没有验证多 Agent 效率，也不引入自动派发。 |
| 4 · 交互与窗口 | 普通通用/局部仍在同一工作区，模型有范围操作；Super Agent 不再埋在普通视图。焦点、全屏绘制与相关页面自动回归通过。 | [#364](https://github.com/wxcvm/dsh-purge/issues/364) 的真实 Windows DPI、窗口恢复、滚动和大块空白没有由静态/夹具测试代验。 |
| 5 · 人工资料、技能与环境 | [#418](https://github.com/wxcvm/dsh-purge/pull/418) 包含既有来源、引用和工作台改进；现有知识来源回归通过。保留人工导入及已有账本，不增加第二套存储或默认下载。 | [#344](https://github.com/wxcvm/dsh-purge/issues/344) 仍待真实宿主技能注册、更新/移除及逐行导入/归档恢复的样本验证；公开 CVE 公告只作资料来源。 |
| 6 · ARTEX 双端 | [#418](https://github.com/wxcvm/dsh-purge/pull/418) 的联动界面已有主线入口；实际下载校验 ARTEX v0.6.0 Windows 制品。Purge 与 ARTEX 版本分别标注，下载证据不代表联动。 | [#346](https://github.com/wxcvm/dsh-purge/issues/346) 仍待真实双端配对、人工采纳、断线重试、冲突及回退；不扩大令牌权限或默认双写。 |
| 7 · 来源裁定 | 指定接手仓库已重新固定 SHA；继续沿用第 5 节的来源目录与历史署名。已吸收题材不重复实现，其他项目仍按明确出处、许可与单项价值比较。 | 历史原仓与 Mojin、富江、REA 等别名没有新的可核实归属，保留待证；不因来源不明添加猜测链接，不移植无人值守攻击和规避流程。 |
| 8 · 版本中心、发布和研究 | 实际下载 Stable .18 / Beta .7-beta.11 并对清单、资产摘要、标签、四个关键文件复核；新增可重复使用的只读校验脚本。研究完成普通规则基线（下方）。 | 不发新版、不提升预览、不替换资产；规则基线不是模型比较，不把 #350 变为依赖。 |

### #376 · rc.5 的官方发布与 rc.3 回归

本轮直接复查 npm 发布的 [dsh-tools](https://registry.npmjs.org/@deepseek-ai%2fdsh-tools/0.2.2-rc.5)、[dsh-llm](https://registry.npmjs.org/@deepseek-ai%2fdsh-llm/0.2.2-rc.5) 和 [dsh-error](https://registry.npmjs.org/@deepseek-ai%2fdsh-error/0.2.2-rc.5)：三者均确实发布 `0.2.2-rc.5`；`tools → llm → error` 是精确同版本 peer，Cordis peer 是 `~4.1.0`。现有夹具用官方 registry 且优先刷新索引；[同一主线提交的 Windows / Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44901063903) 验证安装后的包及 peer，rc.3 使用独立目录并跑原有合约。本轮不改版本、不混装，也不凭 npm/CI 判定 Desktop 或 Provider 已验收。

### #350 · 可重复运行的普通任务路由基线

运行 `node test/fixtures/ordinary-prompt-routing-benchmark.mjs`（Node.js 24）。17 个固定人工标注句仅包含代码审阅、文档/写作、中性对照；在临时配置中仅启用普通规则，10 轮热运行，不调用宿主、Provider 或网络。Windows 样本：规则正好匹配 **13/17**，总是选择同一标签的最优基线 **5/17**；170 次热路由延迟 p50 约 **2.74 ms**、p95 约 **4.42 ms**。Node 进程 RSS 起止约 46.0 → 48.2 MiB，不是峰值或候选模型内存。未匹配样本包括否定、提及某类工作却在请求另一类工作，以及关键词外同义说法；这组小样本不用于估算生产准确率。

没有运行本地模型或取得精度、延迟、资源三项对照，因此**不引入模型、不新增依赖、不改运行时路由**。如以后做对比，先冻结独立样本与验收指标，再在同机记录规则和候选模型的误判、回退、p95 和峰值内存；达不到净收益不采纳。跟踪 [#350](https://github.com/wxcvm/dsh-purge/issues/350)，汇总仍用 [#351](https://github.com/wxcvm/dsh-purge/issues/351)。
