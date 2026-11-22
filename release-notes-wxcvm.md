# 1.1.92-wxcvm.20

## 中文

此版本集中交付 **.19 正式包尚未包含** 的 Harness Desktop `0.2.2-rc.5` 兼容修复及其后已合并改动。发布时以本次独立标签、Release ZIP 和 SHA256SUMS.txt 为准；旧版资产和标签不覆盖。

- **rc.5 Desktop 本机接口恢复**（#470、#479）：兼容官方 rc.5 主进程转发的、绑定当前 Host 的 `dsh-auth-*` Cookie，保留新版 Desktop 会话路径以及跨来源/远端请求的既有限制；诊断会区分“同为 .19 但安装代码早于修复”的情况。解决已定位的 `cross-origin request rejected` 源码兼容根因，**真实用户 Desktop 是否已恢复仍需安装此版后验证**。
- **rc.5 客户端入口**（#482）：移除不存在的旧客户端依赖 `dsh-client-runtime`、`dsh-client-ui-slots`，保留本插件实际使用的 `uiConversation`，增加客户端注入清单回归。Windows/Ubuntu CI 通过不等于用户已运行的桌面进程加载了本次代码。
- **提示词和页面交互**（#480、#481）：修复工作台首次列表读取失败时的错误空状态、刷新后未选项目与概览回报入口异常；在现有提示词管理页显示主/备来源只读状态，保存普通路由仅发送修改过的字段、失败时保留草稿。不改变既有用户提示词正文和实际权限。
- **知识与技能来源**（#471–#475）：显示技能来源、修订和许可，随安装包保留上游 LICENSE/NOTICE 和来源映射；选择性增加已登记的授权审查技能，修复分来源知识检索分页。外部 NetSpy 为可选依赖，不声称随包安装，也不自动联网执行。
- **作战台与 Agent**（#476–#478、#483）：新增按演练隔离的清理登记台账、仅存脱敏元数据的数据存在性证明；官方 Team 任务结束通过隔离夹具核验；修复持久任务审核草稿跨 run/attempt 错带的问题。登记工具本身不删除真实资源，测试不等于实际 Provider 或远程靶标验收。

**验收范围**：本次候选需以同一提交完成 Windows/Ubuntu CI、官方 rc.5/rc.3 隔离宿主合约、npm/Git ZIP 制品和发行包核验。Windows 11 当前 Harness Desktop 的实际安装、重启加载、首次访问与提示词设置保存、Provider 请求交付、回退、ARTEX 双端联动依旧分别追踪 #336/#337/#338/#340/#341/#343；**不得把 CI 绿灯当作这些实机项目已通过**。

## English

Version .20 delivers rc.5 compatibility changes missing from the immutable .19 release: the authority-bound legacy Desktop forwarding cookie (#470), inspection of stale installed bridge bytes (#479), and removal of retired client boot dependencies while preserving the conversation service (#482). It also brings workbench error-state repairs (#480), visible main/backup prompt source with sparse route saves (#481), source/license provenance and curated skills (#471–#475), per-engagement cleanup and redacted data-proof ledgers (#476–#478), stock keyless Team run checks (#477), and exact-attempt review draft handling (#483). No published older archive is replaced. Official pinned CI and packaging checks do not establish a successful live Windows Desktop upgrade, remote Provider delivery, or ARTEX pairing; those remain separate acceptance tasks.

---

# 1.1.92-wxcvm.19

## 中文

本次 `.19` 正式版本整合 `.18` 固定标签 `0bd3a58` 之后的主线改动。独立发布标签、实际 ZIP 与 SHA-256 以本次 GitHub Release 资产为准；`.18` 及更早标签和资产保持不变。

- **提示词与工作区保存**：保护普通全局/局部提示词的编辑草稿、保存冲突和文件写入失败路径；完善实际组装时的当轮请求归属和工作区 UI，避免编辑界面“保存成功”与磁盘状态不一致（#433、#442–#445 等）。
- **Agent 与运行时观测**：扩充 Super Agent 持久任务、人工审核和来源区分；修复 Agent 替换后迟到持久流事件归属，明确“观测到”与“真实 Provider 投递成功”的区别（#429–#430、#446）。
- **安全与隐私**：收紧本机 API 的跨站写入边界与 opaque Origin 检查（#447）；隔离公共上游 Git 读取时的私有凭据与配置，保留显式代理（#448）；共享报告遮蔽私钥、passphrase 以及 YAML 多行敏感值（#449、#450）。这属于定向缺口修复，不代表全部敏感信息已自动脱敏，分享前仍须人工检查。
- **兼容、更新与交付验证**：核实 Windows Desktop 插件安装、链接目录与构建字节的只读证据；改进 release/npm 双归档对账、干净 `DSH_HOME` 安装和回退隔离测试。CI、宿主只读检测、真实加载与实际模型输出仍是不同的验收等级。
- **ARTEX 与其他 UI**：手动审查按明确来源隔离、保存冲突时保留草稿；进一步调整清洗台窗口布局、状态提示与相关管理页面，不把外部系统的状态误认成 Purge 自身确认的结果。

- **Super Agent 本地预览与交付**：普通文档任务支持两项独立检查、依赖汇总、人工要求补充/确认、中断后人工恢复、精确提交的公开 GitHub 检查证据及可核对 SHA-256 的 ARTEX Markdown 手动交接；旧任务列表可翻阅超过 30 条记录（#459–#465、#467）。这是独立 Windows 本地预览，不是正式 Desktop 自动执行器，也未自动同步 ARTEX。
- **官方 Agent Teams 运行基线**：在隔离官方 Harness `0.2.2-rc.5` 的固定无密钥夹具中确认真实 Team 会话、任务依赖顺序和队友消息（#466）。该基线未调用真实 Provider，也不证明 Purge 已在现用 Desktop 加载。
- **版本与发布安全**：版本中心明确区分主线候选、正式 Release、磁盘安装和已加载后端（#458）；正式与历史恢复发布工作流禁止覆盖现有 ZIP / SHA256 资产（#452、#453），本机桥接来源仅接受明确支持的 Desktop 来源（#454），可选 Windows 制品上传故障独立警告、不再误伤编译或 API 测试门槛（#455）；个人知识库增加预览和来源核对（#456）。

**已知尚未完成的实机验收**：Windows 11 Harness Desktop 原位升级、重启加载、实际提示词配置开关与回退；真实 Provider 请求送达，以及 ARTEX 双端登录态联动。Windows/Ubuntu CI 和构建包核对不等于这些实机测试；继续追踪 #336、#337、#338、#339、#340、#343。请从本次 Release 下载 ZIP 并核对随附的 SHA256SUMS.txt，不沿用候选包摘要。

## English

Release notes for changes since the immutable `.18` release: safer ordinary prompt save and draft conflict handling, Super Agent work/review improvements, late-stream observation reconciliation, local browser-origin checks, isolated public-upstream Git credentials, private-key and YAML multiline masking in opt-in shareable reports, and improved read-only package/Desktop evidence. The standalone Windows Super Agent document preview now supports independent checks, manual review/recovery, SHA-bound public GitHub check evidence, deterministic Markdown handoff to ARTEX and task pagination (#459–#465, #467); the official Agent Teams runtime was exercised with an isolated keyless fixture (#466), not a real Provider. Version identity and immutable Release/recovery asset protections were strengthened (#452–#455, #458), and personal knowledge import preview was added (#456). Windows Desktop upgrade/restart/rollback, actual Provider delivery, and ARTEX end-to-end pairing remain unverified and are not implied by CI. Download and verify this release's ZIP and SHA256SUMS.txt; previously published tags and assets remain untouched.

---

# 1.1.92-wxcvm.18

## 中文

本次版本将 .17 之后已经整合至主线的改动集中交付。发布范围以对应标签的源码提交为准，不修改 .17 及之前的 Release/标签/资产。

- **提示词与模型兼容**：新增默认关闭、可切换的上游 dsh-purge-safe v2 提示词备用方案，并修复切换后的原生 persona 恢复（#382、#383）；加强官方 Harness rc.5 / rc.3 宿主契约、真实请求冻结边界和 Windows PowerShell 工具运行测试（#376、#386、#390）。测试覆盖宿主组装与工具边界，不等于远端 Provider 已实际接收或模型不再拒答。
- **拒答与流式观测**：建立带引用归因、尾部判定与真正限制豁免的拒答判定表和基线（#381）；增加受限预算下的空心停止恢复、推理趋势观察、上游适配画像及日志指标。这些用于可观测与受控恢复，不承诺消除模型安全策略。
- **红队 Agent 协同**：接入官方 Agent Teams 的红队根会话模式；以既有 engagement SQLite 持久化结构化子智能体汇报、关注队列与精确 ID 确认，兼容同名上游表并校验存储内容（#384、#385）。
- **本地知识、探针与任务质量**：引入保守的 AboutSecurity 受影响版本范围、离线漏洞历史辅助优先级、独立本地 PoC 链接索引（#387、#391、#392）；补充手动探针运行与只读候选清单（#397、#398），不自动执行候选；加入可选的真实任务质量记录及继续能力（#388）。
- **清洗台 / 工作区 UI**：修正「未执行」进度展示，恢复更有意义的操作进度（#377）；修复工作区原生规则取消勾选后仍进入组装的路径，提供模型、Provider、会话与 Agent 的本地快捷选择，并修整右侧留白（#400）；恢复隐私状态快捷入口（#401）。
- **维护与发布**：拆分字节等价的补丁定义模块（#394），整合上游跟踪与 Codex 执行指引，新增回归测试。Windows 与 Linux 的主线兼容性 CI 已在提交 d93d7203 上通过；本次发布提交还需独立通过版本变更后的 CI 和发布工作流。

**验收边界 / 已知待办**：Windows Desktop 真机安装、升级/回退与重启加载、实际 Provider HTTP 投递、跨页面配置持久化、作战台完整接口与真实 ARTEX 联动仍未凭本次 CI 全部证实，继续跟踪 #336、#337、#339、#341、#343、#361。请勿将自动化测试、界面勾选或本地目录存在误判为这些实机功能已验收。

## English

Consolidated release of post-.17 master changes: opt-in successor-upstream prompt backup with native persona restoration; rc.5/rc.3 host contract and Windows pwsh tests; refusal decision tables and bounded observation/recovery; official red-team Agent Teams plus durable exact-ID handoff attention; conservative offline CVE version ranges, local PoC link index, review-only probe candidates and optional task-quality capture; improved operation progress, workspace-rule opt-out behavior, local target pickers and privacy navigation. Existing published tags/assets remain unchanged.

The Windows/Linux source and host-contract CI is **not** a substitute for real Windows Desktop installation/update/rollback, Provider HTTP delivery, end-to-end UI persistence or ARTEX acceptance. Those remain tracked in the existing issues.

---

# 1.1.92-wxcvm.17

## 中文

本次在 .16 基础上合入已经完成源码与 Windows/Ubuntu CI 验证的提示词组装、错误分类、社区技能和界面改进，不覆盖任何已发布版本的标签或资产。

- **多模型提示词作用域一致性（#369、#372）**：整合三条注入路径的路由开关及组装证据；修复关闭 `modelAdaptive` 后仍向普通或红队规则追加模型家族专用段的问题。关闭时保留已命中的规则正文，开启后按实际模型选择适配；旧低层 API 的省略参数语义保持兼容。
- **上游拒答的诊断与重试（#370、#371）**：正确识别 Harness `CONTENT_REFUSED`，不再误归类为普通 Provider 故障，也不对明确拒答触发自动重试或自动续接。普通的超时、网络错误及其他既有技术故障恢复行为保持原状。
- **提示词管理界面（#373）**：保留三个路由开关，增加全局/局部提示词高级名单的通配符说明、黑白名单优先级说明及紧凑输入布局；没有回灌冲突的旧 `client.js`。
- **社区技能与统一资料分页（#374）**：合并 Yaklang 两套社区技能索引及手动安装、更新、卸载管理；技能目录与统一知识库能够显示来源、浏览分页和读取详情，不自动拉取第三方技能或改变既有技能源。
- **宿主边界测试（#369）**：Windows/Ubuntu CI 已通过官方 Cordis 组装、`renderPrompt` 和 `dsh-llm createSystemMessage` 结构验证，并确认生成客户端一致性。

**尚未由 CI 证明**：真实 Windows Desktop 的安装、切模型／预设、重启后技能管理，以及真实 Provider HTTP 请求投递和拒答来源。系统消息构造成功不代表远端已收到，也不代表模型自身的拒答被消除。后续实机验收继续记录在现有 Issues。

## English

Version .17 incorporates verified source/CI changes since .16: prompt route switch consistency and opt-in model-family adaptation (#369/#372); recognition of upstream `CONTENT_REFUSED` without inappropriate automatic retries (#370/#371); compact advanced allow/deny editor guidance preserving the new routing switches (#373); and manually managed community skill packs plus paginated knowledge browsing (#374). Official Cordis assembly, prompt rendering, and neutral LLM system-message construction passed Windows and Ubuntu CI. Provider HTTP delivery, real Windows Desktop interactions, external skill installation and restart behavior are not yet evidenced by CI.

---

# 1.1.92-wxcvm.16

## 中文

本次在 .15 基础上修复「规则与技能」的工作区规则生效链路并增强诊断；旧版标签和发布资产不变。

- **普通 Agent 也能使用所选工作区规则**：修复旧组装链路对非红队模式过早返回的问题，统一处理标准/极简等普通提示词与本地工作区规则。
- **项目独立配置**：勾选文件、注入方式及逐文件适用范围按项目根目录分别保存；原全局选择仍可读取和保留。
- **明确的组合模式**：默认仍是「空位兜底」，可为单个项目切换「与全局／局部提示词组合」。重复正文及宿主已包含的原生正文不重复注入，保留既有文件总量约束与原「工作区策略」设置。
- **逐文件适用范围**：模型与 Provider 独立白/黑名单（支持通配符）、Agent 预设勾选及自定义预设开关。未设置时不额外限制，无法观测实际模型/厂商时不假装命中。
- **真实状态而非勾选即成功**：显示最近一次实际服务端组装所记录的文件纳入/排除原因、时间与预设，不保存文件正文；组装结果不代表模型最终遵循。
- **Skill 状态辨别**：区分本地文件格式有效、宿主登记未知与实际调用未知，不用文件存在推断成功。
- **验收边界**：Windows/Ubuntu 自动化测试包含项目隔离、多文件组合、作用域匹配和普通模式实际组装。真实 Harness Desktop 的 cwd、模型路由和系统提示词最终效果仍需独立实机验证。

## English

Fixes workspace instruction routing in ordinary Agent modes, adds opt-in prompt composition while preserving the legacy fallback default, per-project selections, per-file model/provider allow/deny and Agent-preset scoping, deduplication, and observed assembly diagnostics. Skill file validity is no longer confused with host registration or successful invocation. CI does not replace real Desktop acceptance.

---

# 1.1.92-wxcvm.15

## 中文

此版本基于 .14，交付已合并的提示词分类界面修正（PR #365），不覆盖旧版本。

- **分类与默认入口**：清洗台提示词管理默认进入「通用与局部提示词」，保留新版全局/局部编辑、模型/厂商/会话/Agent 预设的独立开关与黑白名单。
- **红队单独展示**：原 `prompt-inject.md` 编辑界面归类为「红队专用提示词」，不再作为默认页面。
- **行为不变**：未改提示词正文、既有保存数据、规则路由、Hooks 和注入行为；此次不声称修复模型自身拒答。
- **验收边界**：PR #365 的 Windows/Ubuntu CI 已通过。发布包、SHA256 与 Windows Harness Desktop 实机安装交互仍需独立核对。

## English

UI-only prompt classification update (#365): general/local rules open by default, while `prompt-inject.md` is labeled Redteam-only. Existing per-rule model/provider/session/Agent preset switches and allow/deny lists remain. No saved prompt body, runtime routing, Hooks, or injection behavior was modified. Automated tests do not establish real Desktop acceptance.

---
# 1.1.92-wxcvm.14

## 中文

本次在 .13 基础上改进提示词管理的可用性与 Agent 预设选择，保持旧版本 Release 不变。

- **直观双栏布局**：左侧直接编辑普通全局提示词，右侧展示局部规则清单和选中规则正文；新建规则无需预先设置 ID。常用开关放在正文下方，关键词/模型、厂商黑白名单及会话专属操作默认折叠，避免表单堆叠。
- **按 Agent 预设启停**：每份提示词独立控制标准、PTC、极简、创造（Cordis）、红队五类模式，并有独立「未列出的预设也注入」开关；已显式关闭的模式不受兜底开关影响。身份未知时不假装匹配。
- **红队独立管理**：继续保留旧版 `prompt-inject.md` 作为红队专用正文，普通全局/局部提示词只有明确启用红队预设才作为额外正文加入；保留旧会话手动锁定语义。
- **测试确定性**：环境发现测试显式隔离 Runner 本地 Kali SSH 配置，避免用户已配置的 SSH 环境影响模拟清单测试；不修改实际的 WSL、Docker、ARTEX 发现逻辑。
- **验收边界**：Windows/Ubuntu CI 及发布打包只验证自动化范围，真实 Windows Harness Desktop 的模型/厂商身份、Agent 预设实时切换、最终提示词组装与交互仍需要独立实机核对。

## English

Redesigns prompt management into an always-visible global editor and compact local rule cards, with per-rule Standard, PTC, Minimal, Creator/Cordis, and Redteam preset switches, plus a separate unlisted-presets fallback. Advanced rule scopes remain collapsible. Redteam's original `prompt-inject.md` is preserved, with ordinary prompts joining Redteam only by explicit opt-in. Environment discovery tests isolate host-specific Kali SSH settings without changing runtime discovery behavior. CI success does not establish physical Desktop acceptance.

---

# 1.1.92-wxcvm.13

## 中文

本次独立版本在 .12 基础上交付 Issue #340 的提示词规则改进；不移动或覆盖 .12 及更早标签和资产。

- **通用全局与红队分离**：新增独立、默认关闭的全局提示词，沿用旧红队专属 prompt-inject.md，不会把红队内容自动注入普通会话；两者各自启停。
- **局部规则**：新建按钮直接打开编辑草稿（无需预先填写 ID），可创建任意数量的局部正文与独立开关；本地保存后生效。适用的全局+局部规则按稳定优先级合并至单一 Purge section，不重写宿主原生提示词、工具与上下文。
- **每条单独名单**：白名单、黑名单独立启停，模型、Provider 厂商、会话 ID、Agent 预设均可匹配；黑名单优先。支持精确 ID 与星号通配符；缺失的真实模型身份不宣称匹配。
- **会话与预览**：旧锁定行为保持兼容，新增单条会话暂停/恢复；预览展示命中及排除原因，不调用模型。
- **修复与验证**：避免把正文为空的规则误显示为已注入；补充持久化、宿主回调、作用域及 UI 交互测试。Windows + Ubuntu 自动化检查通过后才合并发布。真实 Desktop 的模型/厂商元数据、提示词 API 404 根因、安装升级和最终系统提示词装配仍需单独实机确认。

## English

Adds independently controlled ordinary global and local prompt rules while keeping the legacy redteam prompt separate. Per-rule allow/deny lists target models, providers, sessions and agent presets; matching rules combine in one Purge section. A new-rule button opens an editable local draft before saving. Per-session rule pause, explicit route preview and regression tests are included. Current CI does not establish real Desktop installation or runtime model metadata coverage.

---

# 1.1.92-wxcvm.12

## 中文

本次在已发布 .11 基础上整合清洗台导航与诊断修复。使用独立 .12 标签与安装包，不覆盖 .11 标签及资产。

- **提示词与诊断**：合并 #353 的一级入口与子页签设计、提示词 API 404 说明，以及提交 791478b 的版本状态总览、默认折叠运行记录、错误细分和页面切换状态保留。
- **加载状态与隐私**：分开显示磁盘插件、已加载后端、前端构建；断连或未重启时不再错误显示运行状态已核验；隐私设置未知时默认遮蔽会话标识和本地导入报告。
- **配置保全**：原平台配置无法解析时拒绝覆盖，不回显原始解析内容。
- **沙箱兼容**：保留已合并 #354 的 #13/#94 补丁：同级/非扩权请求无需额外审批，允许空 justification；实际已安装 Harness 是否打补丁仍需确认。
- **验收范围**：合并后的自动化 CI、发布包资产和 Windows Desktop/Web 安装、重启、提示词 API、模型调用须分别核验。模拟测试通过不等于真实宿主通过。

## English

Integrates #353 and commit 791478b on top of .11, preserving #354. Unifies prompt and diagnostics navigation; adds a runtime overview, collapsible observations, separated API failures, preserved editor/filter state, and safe handling of unreadable platform configuration. The previous .11 release remains unchanged. GitHub CI, release artifact availability and real Desktop/Web acceptance are tracked separately.

---

# 1.1.92-wxcvm.11

## 中文

本次版本基于已发布的 1.1.92-wxcvm.10，合并 Purge PR #330 的提示词规则路由、清洗台管理与来源诊断。保持原 .10 Git 标签与已发布资产不可变；.11 使用独立标签与安装包。

- **提示词库与任务路由**：新增可编辑的并列提示词、关键词/排除词及优先级匹配、会话手动锁定；红队预设沿用原 prompt-inject.md；普通模式无匹配时保留宿主原生装配。
- **会话和宿主兼容**：子代理默认继承父会话提示词，显式锁定可覆盖；只替换 Purge 自身的注入段，保留宿主工具/身份/上下文。
- **清洗台诊断**：区分结构化策略错误、Provider 失败、明确文本拒答与不完整流；增加只读任务类型/能力建议，不自动调用工具。
- **验证状态**：PR #330 最新提交 `076f47f` 的 Windows 与 Ubuntu CI 通过。合并后的 master 集成 CI、真实 Windows Desktop 页面点击/即时模式切换/子代理实际运行及 .11 安装升级需另行核验。本文不把 CI 当作实机验收。

## English

This release follows the immutable .10 publication and includes merged PR #330: editable rule-based prompt profiles, per-session locks, source-aware response diagnostics, and advisory-only task dispatch. The red-team preset still uses the existing prompt-inject.md; unmatched standard tasks keep native Harness assembly. The PR head passed Windows and Ubuntu CI; real Desktop acceptance and final .11 release/install checks remain independent.

---

# 1.1.92-wxcvm.10

## 中文

本次 .10 正式版候选整合 master 中已合并、已通过相应 Windows + Ubuntu 兼容性 PR CI 的清洗、运行时、Agent、知识库与 ARTEX 改进。已有 .9 Git 标签固定在较早提交，不能用于打包这些新改动；因此改用新的 .10 版本，不移动原有标签。最终 master 联合验收、非发布式打包预演和 Desktop 实机验收仍需单独确认。

- **清洗与响应判定**：减少引用内容造成的拒答误判，保留明确的授权范围与权限拒绝、安全边界；普通任务指导按任务需要调整，并减少无效的中性重复检查。此项改善判定精度，不承诺绕过模型自身的安全策略。
- **Provider 与流式运行时**：区分最终响应与失败的流式尝试；保留宿主请求决策和 Provider 自身重试语义，识别永久性失败，取消过期重试，并改进原生工具结果、任务上下文和 token 预算的证据归因；清理陈旧后续请求并遮蔽运行诊断中的敏感内容。
- **Agent 协作与长对话连续性**：支持按依赖关系组织独立只读审查批次，保留任务优先级和顺序，并按可用执行槽位调度；补入 #317 的显式任务连续性、子 Agent 分范围预留、有限交接证据及既有 Agent 页状态显示；不将该能力扩大为活动攻击任务的自动并发调度。
- **富江知识库与技能索引**：整合 167 篇原始资料（105 条组件/CVE、59 条业务安全控制、3 条方法论）与 9 份分类入口；区分来源资料与厂商核对公告（#318），统一 CVE 编号书写和联合检索（#319），修复一条漏洞记录含多个 CVE 的任务上下文关联（#320），避免将四段构建版本截短后误判适用性（#321）。匹配结果仍不等于目标漏洞已验证。
- **ARTEX 与预设修复**：报告审查区分原生分诊状态与报告证据可用性，不把外部状态误写为 DSH 独立确认；修复红队预设 YAML persona 前缀缩进，确保角色与操作章节保留在预期提示词块中。
- **Purge × ARTEX 联动**：Purge 工作台新增直达 ARTEX「资产同步 → Purge 情报」的本机入口（#326），同时保留原首页入口；保存、解除或刷新独立情报配对后清除旧公司概览，避免误显示历史任务和报告（#327）。与 ARTEX `v0.6.0` 的公司预选、可读发现计数和深链接功能（#156、#160）配套；安装器、宿主权限和 Windows 双端实机验收仍分别进行，不把 CI 通过写成已发布或已实测。
- **离线质量评估**：整合离线 Agent 推理基线和虚构记录审查评估工具，用于回归与证据质量分析；这些数据不代表真实目标测试结果，也不构成对实战得分或模型能力的保证。

主要整合：#278–#281、#283–#290、#296–#297、#282、#295，以及 #317–#321 中已合并的专项改动。此前 .8 的 ARTEX 宿主注入与会话靶标绑定修复保持不变。

## English

- Refines cleaning guidance and refusal classification while preserving explicit scope, permission and safety boundaries.
- Improves provider/stream evidence attribution, retry and cancellation handling, task-context correlation, and privacy-safe runtime diagnostics.
- Adds dependency-aware batches for independent read-only reviews; #317 improves long-session task continuity, subagent reservations, bounded handoff evidence and agent status.
- Integrates 167 Fujiang source articles (105 component/CVE references, 59 business-security controls and 3 methodology entries) plus 9 category guides. #318–#321 add advisory links, normalized and multi-CVE lookup, task-context mapping and safer four-part version handling; results remain unverified against live targets.
- Distinguishes ARTEX report availability from native triage status and fixes redteam persona-prefix YAML indentation.
- Coordinates with ARTEX v0.6.0: adds a direct Purge intelligence page link and clears stale company overview after local pairing changes (#326, #327; ARTEX #156, #160). Both applications remain independently installed, and real Windows cross-app acceptance is pending.
- Adds offline quality and evidence-review regression suites; synthetic results are not claims about live-target performance.

Existing .8 and .9 tags remain unchanged. The .9 tag points to an older source revision, so the next release candidate uses the new version .10. Real Windows Desktop acceptance remains a separate step and is not implied by CI.

---

## 历史发布说明：1.1.92-wxcvm.8


### 中文

本补丁修复 .7 正式版在真实 Harness Desktop 的两个问题：ARTEX 本机联动出现 `cannot get property "redteam" without inject`（#274），以及聊天输入框缺少靶标选择指令（#275）。

- ARTEX 状态接口通过独立的 Cordis 注入作用域取得 Purge 数据服务，保留实际配置的数据根目录。
- 数据服务未就绪时返回明确的 503 提示；服务恢复或重载后重新检测即可。主插件及其它 Web 路由不增加硬依赖。
- 新增严格注入代理、服务生命周期及自定义目录回归测试。
- 恢复原生 `/bind` 靶标选择与绑定、解除绑定、当前对话隔离及显式绑定持久化；复用同一份本地绑定记录（#275）。
- 不修改 ARTEX 公司 ID、令牌、项目数据或外部连接配置。真实 Desktop 复验仍需在安装补丁后进行。

### English

- Fixes the ARTEX local-status endpoint on strict Cordis hosts by declaring the store dependency in its own lifecycle scope (#274).
- Uses the actual store root, reports temporary service unavailability clearly, and handles service reload without changing unrelated routes.
- Restores the native `/bind` target picker, per-session binding/unbinding and persisted explicit bindings (#275).
- Adds regression coverage for strict injection, custom roots and service lifecycle. Real Desktop acceptance remains to be verified.

The .7 release remains immutable. See [update recovery](docs/UPDATE_RECOVERY.zh-CN.md) for authorized update and recovery instructions.

---

## Historical notes: 1.1.92-wxcvm.7

## 中文

本次正式版候选整合 master 已合并的维护与工作台改进，延续私有仓库交付。不是将旧 beta 分支整体覆盖到 master。

- 清洗台：运行观测对账、Provider/模型证据、离线任务质量报告；观测不等于模型或宿主协议完整兼容（#264、#266）。
- 作战台：统一技能/知识资源导航、内置离线参考知识及来源区分、ARTEX 知识联动（#262）。
- 智能隐私中心：本机隐私诊断与配置管理（#263）；不代表匿名或公网可达性。
- 任务协调：修复并发预留幂等性、容量统计和分页参数错误（#265）。
- 维护中心：恢复修复中心、桌面运行健康检查与正式版打包分类（#267）。
- 私有更新：支持本机 Git 凭据或进程环境凭据、代理感知下载、进度、安装来源迁移、中断恢复与重启后版本核验（#268）。凭据不应写入安装包或配置文件。恢复操作须按实际宿主和安装方式执行，参见 docs/UPDATE_RECOVERY.zh-CN.md。
- 环境中心：修复配置工具路径指向目录时的误识别，保留原路径以便纠正（#270）。
- 平台管理及 ARTEX：保存失败时保留未提交的勾选；检测失败清除旧在线状态，忽略过期响应（#271）。
- 工作台：统一全窗口视口、Windows 标题栏点击区域，返回会话失败保留页面，渲染异常提供重试（#272）。
- CI：现有 Windows + WSL 自托管兼容性工作流保留。#267、#268、#270、#271、#272 的 PR CI 已通过；本候选最终提交的 CI、发布资产、真实 Windows Desktop/Web 安装升级和界面验收须独立核验。

私有仓库的匿名 codeload 地址并不可用。通过有仓库权限的 GitHub 会话获取发布资产；本地更新使用已支持的授权凭据与对应安装路径。正式发布后以 GitHub Release、对应标签和实际下载资产为准。

## English

- Consolidates the merged master maintenance and workspace changes, including unified skills/knowledge, local privacy diagnostics, read-only runtime observations and offline quality reporting, task coordination, repair center, and authenticated private repository update/recovery.
- Fixes configured tool paths that point to directories (#270), retains unsaved platform choices and clears stale ARTEX connectivity (#271), and restores viewport, caption hit testing and recoverable workspace navigation (#272).
- The existing Windows + WSL self-hosted compatibility workflow remains in use. PR checks for #267, #268, #270, #271 and #272 passed; candidate-specific CI, actual release assets, and real Desktop/Web acceptance must be verified separately.
- Access the private release using an authorized GitHub account. Anonymous archive URLs are not supported. See docs/UPDATE_RECOVERY.zh-CN.md for update recovery.

---

## Historical notes: 1.1.92-wxcvm.6


## 中文

### 最终联合候选：清洗台、测绘、环境和 Agent（#135、#155、#159、#160、#164、#167、#168、#170）

- **清洗台**：六页原生维护工作区、补丁搜索与诊断、备份来源与逐文件哈希核对、宿主更新前后与实际启动指纹、客户端构建标识。历史备份来源未知时明确标注；未提供自动回滚。
- **Agent**：生命周期与并发预留回收、真实运行容量统计、每 5 秒状态刷新；宿主事件匹配仍受原生事件信息限制。
- **网络与隐私**：本地网络快照基线比较、聚合诊断 JSON 导出、只读存储 ACL 审计；ARTEX 隐私概览为可选本机联动，不代表匿名或外部可达性。
- **测绘**：授权范围内的 InternetDB、Shodan、DNS、CT、子域名资料、历史记录和本机 ARTEX 同步；不自动运行目标测试。
- **跨环境**：依据实际工具路径和显式版本探针排名，保留未知状态，不自动执行工具。
- **兼容性（#170）**：在最终联合候选上补齐官方 rc.2 测试夹具的 `@deepseek-ai/dsh-error` 依赖；Windows 与 Ubuntu 的 12 项官方 API/单元测试矩阵全部通过（[CI 43167497780](https://github.com/wxcvm/dsh-purge/actions/runs/43167497780)）。未跳过真实契约测试。
- **验收边界**：上述自动化测试不等于真实 Desktop 安装、更新、恢复或补丁运行效果。实际 Windows 宿主验收仍待完成；声明目标保持 0.2.2-rc.1，rc.2 为已验证 API 兼容性，不宣称完整桌面支持。预览版尚未发布。

### 后续合并：Windows 修复、环境与多节点 SSH 管理（#126–#161）

- **环境适配（#126、#128–#134、#136）**：补充运行中的 Docker 环境发现和显式工具版本检查、工具清单、任务偏好、ARTEX 本机工具来源、执行来源记录、环境拓扑和能力矩阵；VPS 登录配置区分域名、IPv4、IPv6、用户名与私钥路径。
- **Windows 界面（#137–#144、#146）**：原生工作区默认全窗口，修复空白画面、滚动绘制、普通窗口浅色背景、系统标题栏遮挡及按钮点击位置问题。真实 Windows 桌面渲染仍待验收。
- **宿主更新（#145、#147）**：修复补丁影响官方升级、升级后实际版本未变化及陈旧安装器回退问题；仍需真实 Windows Harness 升级验证。
- **隐私与存储（#150–#154、#156–#158）**：共享报告嵌入凭据遮蔽、实际监听绑定信息、ARTEX 本机状态、凭据库完整性与只读 ACL 审计、本机网络隐私诊断及操作指南。诊断不代表匿名、也不证明外部可达性。
- **独立 SSH 多跳管理（#161）**：环境适配新增管理目标、最多四个有序跳板别名、拓扑、保存、校验；本机命令 `node scripts/vps-admin-check.mjs --saved` 检查已保存的路径。可选界面检测要求宿主明确启用、本机回环监听及桥接访问令牌；显示真实连接结果、耗时与时间，路径变化后丢弃旧结果。旧 VPS 配置保持独立。不提供 VPN 流量代理链，也不修改红队工具出口、系统代理或 DNS。使用说明见 `docs/vps-admin-route.md`。
- **交付状态**：#161 最终提交的维护兼容性与 Pending specifications CI 已通过并合并。实际 SSH 登录、用户 Windows 桌面安装及界面验收、Release 发布仍需独立验证。

### 本次发布所含的后续改进（#115–#124）

- **#115 发布与安装说明**：完善 `.6` 安装与使用说明；安装包版本由仓库 `package.json` 和发布标签一致确定。
- **#116 扫描输出预览**：修复读取后无法再次刷新或重试的问题。
- **#117 ARTEX 资产匹配**：修正 DSH 已保存域名、别名末尾句点和前后空格等导致的匹配遗漏，保留开放端口核验。
- **#118 ARTEX SARIF 更换报告**：只有新报告解析成功才替换旧报告；失败时保留核查界面。
- **#119 环境能力基础层**：本机工具发现、状态区分和显式版本检测，保留旧环境入口。
- **#120 ARTEX 知识库界面**：作战台「资源 → ARTEX」直接搜索本机 `knowledge.db`，查看条目与全文；不复制语料。
- **#121 WSL 环境**：显式发现 WSL 发行版和执行选定工具版本探针；不自动启动目标测试。
- **#122 ARTEX 智能体工具**：增加 `redteam_artex_knowledge_search` / `redteam_artex_knowledge_get`。
- **#123 VMware Kali 环境**：可选 SSH Kali 连接、身份和工具版本检查，不自动扫描目标。
- **#124 任务知识提示**：`redteam_task_context` 按 CVE、资产产品名提供最多 3 条 ARTEX 历史知识引用；缺库不阻断任务。
- **交付状态**：相关 PR 已合并并通过 CI；GitHub Release/ZIP 发布与用户 Windows Harness 的原生界面、插件更新、WSL/SSH 实机仍需独立验收。

### 本版主要交付：原生工作区与真实扫描数据

- **#109 原生主工作区**：Harness `main` 与 `sidebar.panellist` 承载清洗台/作战台，旧浮窗仅作旧宿主回退；不再把 Dock 当主要操作方式。
- **#110 清洗导航**：宽屏左侧分类、窄屏顶部分类，区分「清洗与补丁」和「规则与技能」，切换不丢编辑内容。
- **#111 生命周期修复**：关闭的旧 Dock 不再后台重复挂载业务页面；原生页面独立初始化样式。
- **#112 漏洞战果**：完整 SQLite 结果集的有证据/待补证据、获得权限筛选；修复切换条件时陈旧结果覆盖。
- **#113 扫描运行看板**：真实任务记录的全量状态、待复核/失败统计、工具筛选、可展开详情与现有输出完整性核验。
- **#114 执行时间线**：真实扫描开始/结束、输出登记、解析/导入、诊断阶段；按需读取最多 4 KiB 原始输出，遵守历史遮蔽。缺失的独立阶段时间明确显示未知。
- **验证范围**：以上 PR 已合并且其 Windows/Linux 兼容性 CI 通过；代码与 `client.js` 打包文件同步。真实 Windows Harness 的安装、点击与渲染尚待验收。

### 同版本较早修复

- **宿主嵌入式 Dock 实际界面修复**：修复「最大化」窗口仍显示浅色横向页签的问题。最大化作战台现使用深色左侧图标导航，窄 Dock 使用分组页面选择器；按工作区限制主题，不影响清洗页。真实 Windows 屏幕布局还需升级插件后检查。
- **真实作战台视觉重构**：现有 DSH 全面浏览模式直接使用深色工作台、左侧 SVG 图标导航、隐私与测绘卡片网格及三色状态胶囊；窄窗口导航与 Dock 响应式适配，保留原 API、页面状态、配置保存、资产查询与快捷键。同步真实运行包 `client.js`，不再把图片 mockup 当作已实现 UI。真实 Windows/Electron 渲染仍需安装后人工验收。
- **管理桥接隐私**：修复本地回环请求绕过浏览器 Origin 检查的问题；远程 `/redteam/api` 需要显式配置 `DSH_PURGE_BRIDGE_TOKEN`，本机原有桌面行为保持兼容。令牌仅存在于页面内存，支持可选的本机强制认证。
- **暴露面状态**：「低干扰与隐私」页面展示 DSH 当前连接端点、服务端口、令牌配置及尚未验证的公网可达性；同时复用已验证的 ARTEX 本机健康探测，不读取 ARTEX 登录凭据。
- **本地资产库保护**：Linux/macOS 工作区目录与 SQLite 文件使用私有权限；Windows 增加明确选择才执行的 NTFS ACL 工具，默认仅预览，支持临时目录自动测试。
- **可选 AES-256-GCM 凭据字段加密**：用 `DSH_PURGE_SECRET_KEY` 加密新写入的 `credential.secret_value` 与 `webshell.pass_key`；旧库不自动迁移，提供只读数量预览及显式 `--apply` 事务迁移。修复加密后会话总览直接显示密文的问题。
- **可见的加密覆盖情况**：在现有隐私页面显示当前默认工作区内加密/明文记录的数量，不返回口令或密钥。
- **验证**：先前 PR #96–#105 与本轮 #109–#114 已合并；各 PR 的维护兼容性检查已通过。请区分 CI 与实际用户设备的安装验收。
- **仍未验证与限制**：Windows Desktop 真实升级/回滚、VPS 公网可达性、Docker 实际构建/部署，以及生产数据库迁移尚未完成。本功能不是整库加密；扫描原始证据、日志、报告、旧页/WAL、备份和导出仍可能含明文。远程桥接令牌不保护 DSH 主服务或其他插件接口。

## English

### Final integrated candidate (#135, #155, #159, #160, #164, #167, #168, #170)

- Maintenance workspace, backup provenance/hash checks, host update and startup fingerprints, client build identity; no automatic rollback.
- Agent lifecycle/reservation accounting and live status refresh; native event correlation limitations remain.
- Local network baseline/report, read-only ACL audit and opt-in ARTEX privacy overview; scoped passive asset intelligence and local ARTEX synchronization.
- Observed cross-environment tool recommendations based on explicit probes, without automatic execution.
- Compatibility (#170): pin the official rc.2 fixture's missing `@deepseek-ai/dsh-error`; all 12 Windows/Ubuntu unit and official API contract matrix jobs passed ([CI 43167497780](https://github.com/wxcvm/dsh-purge/actions/runs/43167497780)).
- Actual Windows Desktop installation, update, restore and runtime patch effectiveness remain unverified. The declared target remains rc.1; rc.2 API compatibility does not establish full Desktop support. This candidate is not published.

### Subsequent merged work: Windows fixes, environments and SSH management (#126–#161)

- **Environments:** Docker discovery and explicit version probes, tool catalog/preferences, ARTEX local tool provenance, execution provenance, topology/capability matrix and structured dual-stack VPS addressing.
- **Windows:** Full-window native workspace, blank/white paint and caption overlap/click fixes; official updater handoff and stale-version/installer fixes. Real desktop rendering and upgrade acceptance remain outstanding.
- **Privacy:** Embedded credential redaction in shared reports, observed listener binding, ARTEX local posture, vault integrity, read-only ACL and local network diagnostics; these do not establish anonymity or public reachability.
- **#161 SSH administration:** Separate saved management path with up to four ordered jump aliases, add/delete/reorder, topology and validation. Local CLI `node scripts/vps-admin-check.mjs --saved`; optional UI check requires explicit host opt-in, loopback binding and authenticated bridge token. Real result, timing and stale-result invalidation. Existing VPS configuration is preserved. No VPN chain, system proxy/DNS change or redteam traffic rerouting.
- **Status:** #161 final-head maintenance compatibility and pending specifications CI passed and the PR merged. Release publication, actual SSH authentication and real Windows acceptance remain separate unverified steps.

### Additional merged work in this release (#115–#124)

- **#115–#118:** Release/install notes, retryable scan output preview, improved ARTEX asset matching, and preserving SARIF review state when replacement fails.
- **#119, #121, #123:** Local environment diagnostics, explicit WSL discovery, and optional VMware Kali SSH checks. Discovery does not imply a scan was run.
- **#120, #122:** Search/read the existing local ARTEX `knowledge.db` from the Resources panel and redteam agent tools, without copying it.
- **#124:** Add up to three compact ARTEX knowledge references to task context based on recorded CVE/product evidence; full text remains on demand.
- **Status:** PR CI passed. Publishing GitHub Release assets and acceptance on the user's actual Windows Harness remain separate steps.

### Main delivery: native workspace and factual scan results

- **#109:** Native Harness main panel and sidebar entry replace the default floating Dock; an older-host fallback remains.
- **#110:** Dedicated cleaning/patches and rules/skills views, responsive navigation and preserved editors.
- **#111:** Closed Dock no longer duplicates mounted content; native panel owns its stylesheet initialization.
- **#112:** Full-result SQLite evidence and gained-access filters, plus stale-query response protection.
- **#113:** All-run scan dashboard, separate review/failure triage, tool filters, and expandable history.
- **#114:** Timeline from recorded manifest events, on-demand 4 KiB raw-output preview and optional masking; unavailable stage timestamps are shown as unknown.
- **Acceptance:** Each PR passed Windows/Linux compatibility CI. GitHub Release publication and real Windows Desktop installation/rendering are separate, unverified steps.

### Earlier changes in this version

- Implement the dark full-window DSH workbench in the actual React runtime and embedded `client.js`: grouped SVG icon navigation, responsive privacy/survey cards, state pills, and dock-width container queries. Preserve real backend actions. Real Windows/Electron visual acceptance remains outstanding.
- Protect the Purge management bridge from cross-origin browser requests; require an explicit token for non-local `/redteam/api` access while preserving local desktop compatibility.
- Add truthful bridge, observed connection endpoint and ARTEX local-health status to the existing privacy panel. Do not misstate public network reachability.
- Restrict Linux/macOS workspace and SQLite file permissions; add an opt-in, preview-first Windows NTFS ACL utility.
- Add opt-in AES-256-GCM encryption for credential/WebShell fields and a read-only-preview / explicit-apply legacy migration. Fix encrypted WebShell keys in session summaries.
- Surface encrypted versus plaintext counts for the current default workspace without exposing actual secrets.
- PRs #96–#105 and #109–#114 are merged and covered by their respective compatibility CI. Real user-machine deployment and release installation have not been validated.
- Remaining limitations: this is not whole-database encryption. Historical SQLite pages/WAL, logs, reports, backups and exports are not covered. Docker, Windows Desktop and actual VPS reachability still need deployment acceptance.

# 1.1.92-wxcvm.5

## 中文

- **ARTEX 只读集成**：清理台自动识别本机 ARTEX Desktop 布局，复用其**已安装**的 Go 后端与工具路径；只读解析、不改 ARTEX 配置、不启动其进程，受保护目录与离线共享盘分别标注。
- **清理台增强**：补丁可搜索；新增只读补丁重扫；诊断结果可筛选导出；同一补丁下子状态不一致时显式显示「混合」，不再用父状态覆盖。
- **CVE 候选更硬**：候选匹配只认实际观测到的指纹，不再靠版本号猜；新增伏匠离线 CVE 索引；任务上下文里直接带出相关 CVE 与技能提示。
- **AboutSecurity 技能库（可选）**：界面「管理 → 技能库」可显式安装/更新上游 `wgpsec/AboutSecurity` 的 `skills/`，启动与 `postinstall` 都不会自动拉取；新增 `node scripts/install-aboutsecurity.mjs --remove` 卸载，只删本脚本创建的检出，遇到非 git 目录一律拒绝（4 条守卫用例覆盖）。
- **装配契约**：`rewritePromptAssembly` 不再凭空补 `tools` 字段，`interpolate:false` 的正文逐字保留，装配失败原样冒泡；用例由 `test-pending/` 收编进 `test/prompt-compat.test.mjs`。
- **Windows 桌面**：新增插件注册校验；pnpm junction 场景下的**完整回滚**已被自动化测试覆盖。
- **测试口径统一**：`npm test` 固定为 `node --test test/*.test.mjs`，与 CI 的显式文件清单一致（裸 `node --test` 会把需要真实宿主的手工脚本当测试跑）。另提供 `test:pending` / `test:all`。
- **仍未验证**：真实 Windows Desktop 的升级/回滚、AboutSecurity 技能的模型实际调用、ARTEX 布局差异、以及长时间演练下的性能表现。

## English

- Read-only ARTEX integration: reuse locally installed ARTEX tool paths, never mutate its config or start its processes.
- Cleaning console: searchable patches, read-only rescan, filtered diagnostic export, honest mixed child states.
- CVE candidates now require observed fingerprints; add the offline Fujiang index and surface CVE/skill hints in task context.
- Optional AboutSecurity skill library with explicit install/update and a guarded `--remove` (only the checkout this script created; non-git directories are refused).
- Prompt assembly contract: no invented `tools`, literal `interpolate:false` bodies, assembly errors bubble up unchanged.
- Windows desktop: plugin registration validation and a full pnpm-junction rollback test.
- `npm test` now uses the same explicit glob as CI; `test:pending` / `test:all` remain available.
- Still unverified: real Windows Desktop upgrade/rollback, live model invocation of AboutSecurity skills, ARTEX layout variants, long-running performance.

# 1.1.92-wxcvm.4

## 中文

- **Windows Desktop 升级故障恢复**：升级前完整保存旧插件文件与 profile 关键配置，记录 SHA-256；失败时先尝试按原锁文件重装依赖，如无法恢复，再使用插件快照。被占用或部分回退失败会保留备份与错误，**不宣称真实 Desktop 已通过验收**。
- **源码诊断更准确**：优先与已安装版本对应的 GitHub Release 标签比较 6 个关键文件，不再默认用持续变化的 master 误判旧发布版；UI 显示比较基准。标签不存在才回退 master。
- **可选分享版报告**：命令行报告增加 `--shareable`，基础脱敏常见凭据、目标名称和 IPv4，省略原始截图，原版完整导出不变。自动脱敏并不等于完整匿名，分享前仍需人工复核。
- **交付核对总账**：`docs/DELIVERY_AUDIT.zh-CN.md` 对照旧备份、研究结论、已修复项与真实 Desktop 验收缺口。
- **固定安装来源**：桌面安装深链与 package.json 内的发布包 URL 指向本次 `v1.1.92-wxcvm.4` 标签，避免版本号与 master 漂移导致包内容不一致。
- **测试与发布**：Windows/Linux 宿主兼容矩阵保持不变，发布文件同时提供 ZIP 与 SHA256SUMS.txt。默认依然为 fork 手动发版；本次仅使用精确指定的单次发布提交。
- **仍未验证**：用户真实 Windows Desktop 的 DSH profile、技能的实际模型调用、更新与回滚时的真实 pnpm junction、进程占用场景。

## English

- Snapshot prior plugin files and profile metadata before updating on Windows; verify hashes and restore files after failed pnpm recovery.
- Compare installed key files with the exact release tag rather than moving master.
- Opt-in `--shareable` report bundle with basic masking and omitted screenshot evidence; full original export remains unchanged.
- Add a concrete historical-backup/delivery audit ledger.
- Pin release install metadata and desktop deep links to `v1.1.92-wxcvm.4` rather than branch HEAD.
- Publish SHA256SUMS.txt alongside the GitHub Release ZIP; real Desktop integration acceptance remains pending.
