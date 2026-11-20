# Purge 接手版上游吸收 · Codex 可执行总方案

> **2026-11-20 源码/任务快照**。维护仓库 [wxcvm/dsh-purge](https://github.com/wxcvm/dsh-purge)，默认分支 `master`。本文是**任务导航与执行方案**，不是“全部已完成”声明，也不代替当前 GitHub PR、CI、Release 和实机验收记录。
>
> **Codex 先读**：仓库根目录 [`AGENTS.md`](../AGENTS.md) → 本文 → [#347 接手版/社区上游追踪](https://github.com/wxcvm/dsh-purge/issues/347) → [#351 全项目总台账](https://github.com/wxcvm/dsh-purge/issues/351)。随后检查最新 `master`、未合并 PR、CI 和目标文件；旧文档中的 commit SHA 和技能数量都是当时的快照，不能替代最新核查。

## 1. 关系与决策（不要混同）

1. 原始 Purge 项目：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)；本仓库已有其 LICENSE/NOTICE 及历史署名。
2. **指定重点维护上游 / 本轮主要差异来源**：[CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe)；用户已明确选择将它作为未来优先跟踪对象。已审查基线：[`main@d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec`](https://github.com/CallMeGuLab/dsh-purge-safe/tree/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec)（上游 v2.0.0、文档描述目标 DSH 0.2.2-rc.3）。
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

**当前在审 PR（2026-11-20 08:56 CST）：** [#385 Agent attention/ack](https://github.com/wxcvm/dsh-purge/pull/385) 为 **Draft、未合并**；其头提交 `e188f5adcb76cf8c72c8693cc6351c22f76c69fd` 的 [Windows/Linux CI 已通过](https://github.com/wxcvm/dsh-purge/actions/runs/44646881605)。这不等于正式安装包更新或 Desktop 验收。另有 [#386 官方 Provider 最终请求证据](https://github.com/wxcvm/dsh-purge/pull/386) 开放；须独立核对其最新代码、CI 与覆盖范围。

## 3. 按原始上游源码逐项吸收（有明确文件入口）

以下链接固定到上游 `d96c5f25`，可直接供 Codex 打开，避免后续 `main` 更新使任务含义漂移；追新提交时另查 [上游 commits](https://github.com/CallMeGuLab/dsh-purge-safe/commits/main) / [releases](https://github.com/CallMeGuLab/dsh-purge-safe/releases)。

| 顺序 | 上游原始源码/方案 | 我方落点或待办 | 执行判断 |
| --- | --- | --- | --- |
| A · 已合并 | [`lib/identity.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/identity.js)、[`lib/asset-table.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/asset-table.js) | [`lib/upstream-safe-prompt.js`](../lib/upstream-safe-prompt.js)、[`lib/upstream-safe/asset-table.js`](../lib/upstream-safe/asset-table.js)，PR #382/#383 | 只导入默认提示词备份和组装适配，遵循现有路由；**不从上游批量复制 tool-gate/subagent-control** |
| B · 已合并 | [`lib/redteam/team-mode.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/team-mode.js) | [`lib/redteam/native-team-mode.js`](../lib/redteam/native-team-mode.js)，PR #384 | 只启用宿主官方 Team 模式；不要重复注册 `team_task_*`、覆盖已有 `team/mode` |
| C · **待验收/待合并** | [`lib/redteam/tools.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/tools.js)、[`store-core.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/store-core.js)、[`schema.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/schema.js) | PR #385：新的 `agent_attention` **表位于已有靶标 SQLite**；`redteam_attention(action=list\|ack)`、`subagent/end` 报告解析、精确 `report_id` 确认 | 上游 `agent_report` 与我方表结构不同，**不能直接共用表名**；旧报告不能因确认新报告而重新出现；无结构化信息不能凭空推断 waiting |
| D · 暂不导入停泊算法 | [`lib/redteam/slot-state.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/slot-state.js) | 我方 [`agent-reservations.js`](../lib/redteam/agent-reservations.js)、[`agent-status.js`](../lib/redteam/agent-status.js) | **waiting/blocked 是回报，不证明宿主已释放真实运行资源**；不把 “parked” 从已观察 running 里直接扣除。free 未验证时维持 unknown/null |
| E · 下一批 | [`lib/redteam/bootstrap-runtime.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/bootstrap-runtime.js)、[`kev.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/kev.js) | #344/#360：与现有 Nuclei 模板搜索、CVE / KEV 来源管理比对 | 补增量仅在缺口存在时做；优先**状态可见 + 显式手动刷新**，避免照搬启动时 `download:true, background:true` 造成隐式联网 |
| F · 下一批 | [`lib/redteam/tools.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/tools.js) 内 `redteam_batch`、`redteam_cleanup` | #352/#345：检查我们现有批量导入、任务记录去重与清理入口 | 先对比数据主键/事务/幂等/删除实际影响；只移植缺失能力，不建立第二套批处理引擎 |
| G · 下一批 | [`lib/redteam/client.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/redteam/client.js)、[`lib/ui-fullscreen.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/ui-fullscreen.js)、[上游预览图](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/docs/preview/dock-clean.png) | #343/#352/#364/#361：作战台概览、Agent 待办 UI、清洗台信息密度、全屏及点击热区 | 界面按人类使用路径归类；不整包替换 `client.js`，截图不是当前 Desktop 可运行证据 |
| H · 持续对照 | [上游 `skills/redteam/`](https://github.com/CallMeGuLab/dsh-purge-safe/tree/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/skills/redteam)、[`redteam-superagent-dev.md`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/docs/redteam-superagent-dev.md) | #344/#302：技能及知识库文件级差异；核对 Team 能力与设计稿 | 旧快照上游 40 / 我方 47 份 Markdown 的同名/独有差异仅供检索起点；**上游超代理 agent_task 设计稿不代表已实现** |
| I · 独立评估 | [`lib/tool-gate.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/tool-gate.js)、[`lib/subagent-control.js`](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec/lib/subagent-control.js) | #337/#341/#342/#355：与当前 Harness 的执行/审批/Provider 行为核对 | 存在大范围交互语义变化风险；**不作为提示词/Team 引入的隐含依赖**。发现真实缺口再提针对性方案 |

## 4. Codex 后续实施队列（逐项做完才更新状态）

### P0. 先验证真实宿主请求与发布链（优先于宣称“已修”）

- **目标**：确认真实 Windows Desktop + 指定 Harness 版本下，Purge 当前加载的是哪个代码、补丁实际是否有效、Provider 收到的最终 System Prompt 是否符合预期。
- **位置**：[#336 安装/回退](https://github.com/wxcvm/dsh-purge/issues/336)、[#337 应用→重启→重连](https://github.com/wxcvm/dsh-purge/issues/337)、[#339 pack 合约](https://github.com/wxcvm/dsh-purge/issues/339)、[#340 提示词](https://github.com/wxcvm/dsh-purge/issues/340)、[#341 流式](https://github.com/wxcvm/dsh-purge/issues/341)、[PR #386](https://github.com/wxcvm/dsh-purge/pull/386)。
- **核验链**：`source-readable → router-selected → assembled → official rendered → final provider request`，并分别记录实际请求/结果、宿主版本、活动 Profile/插件版本、重启后加载路径；**assembled 不等于 delivered**。
- **矩阵**：红队/普通/minimal/自定义预设 × 主/备用切换 × 有/无 `{{cwd}}` 插值 × 用户全局/局部开关与 Session 锁定 × 子代理/根会话。逐案验证只注入一次、原生上下文/工具保留、无额外默认启用。
- **完成标准**：真实宿主的只读证据、前后对照、相应测试、明确的未测 Provider 列表；不要仅凭 CI、UI 显示或旧版安装包称完成。

### P1-A. PR #385 结构化 Agent 待办闭环

- **先做**：检查 [PR #385](https://github.com/wxcvm/dsh-purge/pull/385) 最新 diff、Windows/Linux checks、与 `master` 的代码冲突及 SQL schema；审查后才决定合并，不把 Draft 当已合并。
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

1. **读完再改**：先 `git status`，比较实际 `master` 与开放 PR，检查相关 issue、上游固定 SHA 的源文件和现有测试；不要把已合并功能重新做一遍。检查 GitHub 私库与当前工作区有访问权限。每个功能补丁只使用其真实来源和兼容接口。
2. **每轮一个焦点**：修复根因 → 最小相关代码 → 必需测试 → CI/宿主检查 → 在对应旧 Issue / PR 贴结果。与并行 Codex/DSH 产生冲突时优先小范围合并，不覆盖他人的未提交更改。
3. **状态五分法**：`提议`、`代码已提交`、`已合并且对应 CI 通过`、`真实 Desktop/Provider 已验收`、`已发布`。状态变化只根据可打开的提交/PR/CI/安装证据更新；各阶段不互相替代。
4. **执行目标范围**：不擅自增加功能黑名单、并发上限、批准步骤或服务依赖；真实宿主既有规则与权限不因吸收外部代码而暗中改变。若确实需要改变既有用户行为，先写出缘由和影响范围。
5. **交接更新位置**：具体源码差异、下一步补丁写回 [#347](https://github.com/wxcvm/dsh-purge/issues/347)；全项目进度在 [#351](https://github.com/wxcvm/dsh-purge/issues/351)；涉及的既有 #340/#343/#344/#345/#346 等按模块补充。每条说明包括**原始链接、代码路径、问题、推荐方案、完成条件、PR/CI 与未验证项**，不新开一套重复事项。
6. **同步校验**：新增或更新文档链接后，确认文件已在默认分支；原始上游 commit 链接可打开；任务引用没有标成不真实的“完成”。文档改动本身**不**代表 CI 或 Desktop 验收。

### 可直接交给 Codex 的第一条任务

> 阅读根目录 `AGENTS.md`、`docs/CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md`、Issue #347/#351。核对当前 master、所有相关开放 PR 与最新 CI；从本方案**最高优先级且未完成**的最小任务开始。逐项查上游固定 SHA 的原始源码和本仓库现有实现，定位根因、做必要改动并跑相关测试，提交到对应旧 Issue/PR。不要重复造数据库/路由/Agent Teams，也不要把 CI、模拟渲染或界面提示冒充真实 Provider/Windows Desktop 验收；保留可核对的来源链接、改动路径与剩余缺口。只在证据充分时推进合并或发布。
