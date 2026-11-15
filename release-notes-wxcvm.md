# 1.1.92-wxcvm.7-beta.11

## 中文

- 整合 #245–#249、#251：修复中心、启动配置与同版本缓存恢复；更新器统一检查六项运行时文件，失败后保留旧应用与新归档，避免混合版本。只读 ASAR 布局诊断不移动宿主文件。
- 运行观测保留真实流式终态，区分实时与持久事件，迟到事件按已提交序号对账；Agent 替换和回合取消不伪造结束状态或耗时。
- 区分明确 Provider 终态、HTTP 客户端错误和临时传输故障；保留既有网络重试预算，取消和新回合使旧回调失效。
- #250：原生 /bind（冲突时 /purge-bind）可搜索已有靶标、绑定/更换/解绑；显式绑定随重启保留，根会话与子会话继承；不改全局当前靶标。旧宿主保留文本命令。弹窗内创建及顶部靶标标识仍未实现。
- #244：更新判断按预发布标识的数字顺序比较，修复 beta.9→beta.10/11 的误判。旧客户端需通过显式安装过渡，旧版的运行时代码不会被远端发布自动修正。
- 验收边界：各原始 PR 的 CI 已通过，联合发布候选需自身 CI 与 Release 归档核验。真实 Windows 桌面首次绑定、升级、网络断开/重连与 socket 释放仍待实机验证。仅预览通道，不提升 master，不修改生产安装。

## English

Integrates repair and recovery, stream observation reconciliation, provider error attribution, cancellation lifecycle fixes, native session binding, and numeric prerelease update comparison. Beta only; real desktop binding, installation and network fault injection remain pending. No stable promotion.

---

# 1.1.92-wxcvm.7-beta.10

## 中文

- 拒答识别改为明确拒答 / 未检出 / 不确定三态；道歉、建议、占位符、只读承诺和执行限制不再单独判成软化、拒绝或未交付。
- 按代码、引用、日志、表格范围识别归属；删除短回复加分和全篇关键词豁免。保留旧 API，新增原因码与 precision-1 版本。
- 交付证据独立于文本与宿主终态：未验证不等于未交付，只有绑定任务/回复的验证证据才能确认；原 #241 首答与最终交付指标不改义。
- 修正 rc.3 用户事件读取，绑定当前回合，取消新消息、取消、替换 Agent、重挂后过期的延迟动作。不确定/部分拒答不触发；移除跳级施压与预设未交付结论，不提高预算。
- 运行诊断、离线评测共用判定；新增日志仅保存元数据，不追加原文摘录，不扫描或学习私人历史日志。
- 62 条工程回归样例：38 条正常回复误判 21→0（其中 7 条保留不确定），13 条明确拒答识别 13 条，11 条含糊回复全部不确定。不是盲测或真实流量准确率。
- 真实 rc.3 隔离 profile 的 3 条正常输出验证通过，零额外 followup；仅验证识别层，不是完整 Purge 对照。生产 beta.10 原生界面、在线安装和长期流量尚未验收。
- 本机仍有已知 Windows ACL 预览读取失败；非门禁 Pending specifications 仍因缺少 liveRunningChildren 导出失败（与 beta.9 相同），不计作通过。Linux/Windows 兼容门禁单独验证。
- beta 通道发布，master 不提升；不覆盖生产插件，不创建安装备份，不执行回滚。

## English

Precision-first response attribution, explicit abstention, independently verified delivery states, rc.3 message normalization and stale-action cancellation. Shared runtime/report diagnostics preserve unknowns without treating normal replies as refusal or non-delivery. Engineering regression and three real isolated-profile normal-output probes passed; not an independent accuracy benchmark or full Purge comparison. Beta only, with no production installation or stable promotion.

---

# 1.1.92-wxcvm.7-beta.9

## 中文

- 实证修订并整合 #239：按运行安装 app.asar 的 rc.3 契约核实流式事件、请求头与持久结算顺序，不再把协议字段或研究假设当成运行事实。
- 新增只读运行诊断：Agent 生命周期隔离、首文本延迟、用量、终态与持久结算。缺少 finish 时保持 unknown，不使用宿主默认 stop 冒充正常完成；最多 200 条内存元数据，不保存提示、正文、思考或工具参数。
- 清洗台新增运行诊断与浏览器本地质量报告导入；可见时最多每秒刷新，不扫描宿主磁盘。新增只读 GET /dsh-purge/runtime-observations，复用原路由保护。
- 扩展现有质量评测：人工复核的误拒统计、明确分母、候选分类混淆矩阵、首文本指标与上下文采集完整性。整合 #241 的首答/最终正确率和独立重复执行计数，缺失观察不填零。
- 提供 opt-in 三组采集脚本，必须使用三个现存隔离 profile；不改生产 profile，不安装新服务或购买额度。
- 已完成真实 rc.3 观测探针：正常算术任务返回 94，实际收到 start/chunk/end 和持久事件。它不是完整 Purge 三组对照，不证明整体自主能力或成本改善。
- 验收边界：新诊断页未部署到生产桌面；完整三组真实模型实验、真实图形界面验收及在线安装未完成。沿用 beta 测试通道，master 不动；本次不覆盖生产安装、不执行宿主补丁、不创建安装备份或回滚。

## English

Read-only rc.3 stream diagnostics, explicit unknown terminal states, bounded metadata, local report import and reviewed quality metrics. Includes #239 research corrections and #241 observed delivery metrics. A real observer-only model probe passed; full three-way Purge comparisons, production UI acceptance and online installation remain unverified. Beta only; no stable promotion or production deployment.

---

# 1.1.92-wxcvm.7-beta.8

## 中文

- 整合 #217—#225：任务级进展、持久尝试、执行器观察、依赖与局部路线、失败知识引用、原子记录回执及跨进程验证。没有自动重放未知操作。
- 默认适配 Harness 0.2.2-rc.3；受控真实模型多阶段/原生会话接续已跑通，增强链路调用与 Token 更多，不宣称整体自主能力或性能提升。
- 修复清洗台检测更新未使用本机代理/Git 凭据的问题；令牌仅在内存使用，仅发送本 fork 的 HTTPS GitHub API，不写入 profile、日志或客户端。
- 同一检测结果显示原插件/官方 Harness 的只读上游观察；不可访问为未知，不自动改源或覆盖二开。
- 本机部署按用户要求不备份、不回滚、不重新应用宿主补丁。完整在线归档更新/迁移与长期任务效果仍单独验收；检测成功不替代下载/安装成功。

- #227–#228：修正 Desktop 宿主版本识别，区分宿主、插件及运行版本，补充只读升级验收。
- #229–#230：增加合成任务离线质量评估与配对效率统计；仅比较双方正确且有测量值的样本，不代表真实模型提升。
- #231–#232：只读事实刷新可跳过重复知识检索，默认完整检索不变；真实 Token、耗时与内存收益尚待测量。
- 最终验收：真实 LM Studio 中文检索、长会话内存、界面响应及完整 Desktop/Web 在线安装更新仍待验证。私有 Beta，master 不提升。

## English

- Integrate persistent task progress, attempts, executor observations, dependencies, failure references and atomic record receipts without replaying unknown work.
- Target Harness rc.3; controlled native-session continuation passes, with higher candidate tool/token usage and no established overall autonomy or performance gain.
- Fix in-app update checks using the current proxy and noninteractive Git credentials; no credentials are persisted or exposed to the renderer.
- Show read-only upstream observations, preserving unavailable as unknown. No automatic upstream replacement.
- This local integration uses no backup/rollback or host patch reapplication; archive installation and long-running effectiveness remain separate acceptance scopes.

- #227–#228: distinguish Desktop host, plugin and runtime identities; document read-only upgrade acceptance.
- #229–#230: offline synthetic quality evaluation and paired efficiency statistics for jointly correct samples with measurements; no claim of model improvement.
- #231–#232: optional facts-only refresh avoids repeated knowledge retrieval; default full retrieval remains unchanged. Actual token, latency and memory gains remain unmeasured.
- Pending acceptance: real LM Studio Chinese retrieval, long-session memory, UI responsiveness and complete Desktop/Web online installation/update. Private beta only; no master promotion.

# 1.1.92-wxcvm.7-beta.7

## 中文

- #211：执行准备记录持久化、原子更新运行清单、未终结状态和未登记导入结果提示；ARTEX 表结构检查、五来源检索覆盖、SQLite 概览分类与历史分页优化。
- #214：本地语义向量逐块读取、保持原有排名与分值，明确损坏索引；任务摘要常见凭据脱敏、知识源故障隔离、结构化异常分类；区分文件完整性、执行记录和导入状态。
- #215：按精确运行清单路径观察当前进程中的等待结果及导入阶段，完成或异常后清理；按已记录的 scan_run_id 在同一项目数据库内核对导入记录，不猜测关联。
- 未终结记录、未观察到活动或文件核验通过均不证明任务成功或中断；没有自动重放、自动重新执行或跨进程恢复。脱敏是尽力处理，不代表完全匿名化。
- 合并前代码通过 #211、#214、#215 各自的维护兼容性及规格检查；本联合发布候选仍需自身完整 CI 和现有 Release 归档检查。真实 Windows Desktop/Web 安装更新、重启、图形界面、LM Studio 中文召回、长任务与性能验收尚未完成。
- 私有 Beta，正式 master .6 和旧标签保持不变。请参阅 [私有更新说明](docs/PRIVATE_UPDATE.zh-CN.md)、[知识中心](docs/KNOWLEDGE_CENTER.zh-CN.md)及[作战台使用说明](docs/drill-console-usage.md)。

## English

- #211: durable preparation and finalization records, unfinalized/unfinished-import diagnostics, ARTEX schema and knowledge coverage, SQLite overview aggregation and paginated history.
- #214: streamed local semantic vectors with unchanged ranking, corrupt-index diagnostics, best-effort credential masking, isolated reference-source errors, structured tool failures and distinct file/execution/import results.
- #215: exact manifest-path current-process activity observations with cleanup; recorded scan_run_id reconciliation within the same project database, without guessing associations.
- Unknown activity or a verified file does not prove completion or interruption. No automatic replay, repeat execution or cross-process task recovery. Masking is not comprehensive anonymization.
- Each integrated runtime PR passed compatibility and specification CI. This combined release candidate still requires its own CI and existing archive checks. Actual Windows Desktop/Web updates, restarts, rendering, LM Studio Chinese retrieval, long-task and device performance acceptance remain pending.
- Private Beta; stable master .6 and previous tags unchanged. See the private update, knowledge center and console guides.

# 1.1.92-wxcvm.7-beta.6

## 中文

- #205：统一知识检索区分 ARTEX 未安装、空库与读取故障；单个来源异常不影响其他知识源。
- #206–#208：异常子智能体记录不误报空闲；区分数据库已保存进度与实时执行状态，概览和测试记录页显示最后记录时间并移除误导性运行指示。通过数据库重新打开的回归测试，尚未实现自动任务恢复。
- #209：报告和任务摘要常见凭据脱敏，标记摘要省略项及历史知识引用来源；保留个人知识与原始证据。脱敏是尽力处理，不代表完整匿名化。
- #200：个人知识凭据检查与版本审计、代理/DNS 静态配置检查、会话观测证据范围、本地服务配置和日志诊断、Windows 工具包装脚本与 Npcap 诊断。静态检查不证明实际网络路径、服务健康或可达性。
- 集成代码提交 c365a45 的 [Maintenance compatibility](https://github.com/wxcvm/dsh-purge/actions/runs/43374931922) 与 [Pending specifications](https://github.com/wxcvm/dsh-purge/actions/runs/43374931947) 已通过。本版元数据提交仍需完整 CI 与 Release 归档检查。
- 私有测试候选：正式 master .6、旧标签不变；真实 Windows Desktop/Web 安装更新、重启、界面渲染、LM Studio 中文召回和性能尚待实机验收。通过 [私有更新指南](docs/PRIVATE_UPDATE.zh-CN.md) 使用授权取得的包。

## English

- #205: distinguish missing, empty and unreadable ARTEX sources in federated knowledge search; preserve results from other sources.
- #206–#208: count malformed child records as unknown, not free capacity. Distinguish stored progress from live host activity in task context and UI; add SQLite reopen coverage and last-recorded time. Automatic task resume is not implemented.
- #209: mask common credentials in report and task summaries, indicate omitted summary content and historical-reference provenance while retaining raw evidence and personal knowledge. Best-effort masking is not comprehensive anonymization.
- #200: personal knowledge credential review and history audit; static proxy/DNS configuration checks; session observation scope; local service configuration/log diagnostics; Windows wrapper and Npcap diagnostics. Static checks do not establish network reachability or runtime health.
- Integrated code c365a45 passed both CI workflows. This release metadata revision still requires full CI and archive verification. Stable master .6 and prior tags are unchanged.
- Private beta candidate: real Windows Desktop/Web installation, update/restart, UI rendering, LM Studio retrieval and performance acceptance remain unverified. See [private update guide](docs/PRIVATE_UPDATE.zh-CN.md).

# 1.1.92-wxcvm.7-beta.5

## 中文

- 新增作战台「资源 → 知识库」：独立个人文档、分类、标签、收藏、中文关键词搜索，不依赖靶标。
- 五来源统一检索：个人文档、CVE 索引、内置技能、AboutSecurity、ARTEX；外部库只读，缺失来源独立提示。
- Agent 增加知识检索/原文读取与来源引用，任务上下文提供简短个人资料引用。
- 可选 LM Studio 本地嵌入语义检索：分段、SQLite 持久化、相似度与片段，编辑/删除自动失效；仅个人文档，无云端回退。
- Markdown/TXT 批量导入、JSON 备份恢复为副本、文档历史预览/恢复、人工任务经验模板；新文档 ID 不复用。
- 五阶段联合功能 CI 已通过 Windows/Ubuntu 新旧宿主矩阵；本发版提交仍须通过完整 CI。真实 Windows Desktop/Web 私有安装、页面和 LM Studio 中文召回仍待实机验收。Stable .6 不变。
- [知识中心指南](docs/KNOWLEDGE_CENTER.zh-CN.md) · [私有安装指南](docs/PRIVATE_UPDATE.zh-CN.md)

## English

- Add a standalone personal knowledge center with documents, categories, tags, favorites and Chinese keyword search.
- Federate personal documents, public CVE metadata, bundled skills, AboutSecurity and ARTEX; keep external sources read-only.
- Add agent search/read references and compact personal-document references in task context.
- Optional local LM Studio embeddings, persistent SQLite chunk vectors and similarity retrieval; document changes invalidate vectors. No cloud fallback.
- Batch Markdown/TXT import, JSON backup/restore as new copies, revision history/restore and a manual experience template. New document IDs are not reused.
- Combined feature CI passed on Windows and Ubuntu current/legacy hosts; release revision CI and real Desktop/Web installation, UI and LM Studio retrieval acceptance remain separate. Stable .6 unchanged.

# 1.1.92-wxcvm.7-beta.4

## 中文

- 联合 #180、#181、#182、#183：私有仓库授权查询、下载与本地安装包缓存，独立 profile 迁移、更新恢复记录及重启核验。
- 工作区默认铺满、Windows 标题栏点击区域修复；布局和样式源码化，统一生成客户端，构建标识 541d525c8dfcf246。
- 更新中心显示实际下载速度、下载剩余时间、文件覆盖进度及失败阶段；清洗台诊断区分磁盘、后端、前端与宿主版本。
- 联合运行时代码的 Windows/Ubuntu 新旧宿主兼容 CI 已通过。此版本元数据提交仍需 CI；真实 Windows Desktop/Web 授权更新、profile 迁移及界面验收尚未完成。
- 私有仓库请使用授权取得的发布包与私有更新说明；不再提供匿名一键安装入口。Stable 不变，尚未发布。

## English

- Integrate private repository authorization, archive caching, offline profile migration, update recovery and restart verification (#180–#183).
- Stabilize the full workspace and Windows caption hit testing; extract shell and CSS sources and regenerate the client (541d525c8dfcf246).
- Report actual update stages, download speed/ETA and disk/backend/renderer identities.
- Combined runtime CI passed on Windows and Ubuntu. This version metadata candidate still needs CI; real Desktop/Web private updates and profile migration remain unverified. No release or stable promotion.

# 1.1.92-wxcvm.7-beta.3

## 中文

- 继承 beta.2 的实时版本切换进度、完整运行资源复制及原生工作区修复。
- #174：独立 Windows 升级支持固定 Git 提交，验证运行资源，安装失败恢复旧插件与 profile。
- #175：ZIP 更新覆盖前检查发布包，备份全部受影响的文件组；复制失败恢复旧文件，恢复失败保留备份。新增持久化恢复日志和独立恢复工具，阻止未恢复事务进入新更新。
- 更新收据区分中断、待重启、磁盘不一致和后端启动核验；前端实际加载仍需实机检查。
- 本候选仅面向 beta。ZIP 文件事务不包含 Git checkout、profile 配置和后续宿主维护，突然断电持久性及 Windows Desktop 实际升级/重启尚未完成验收。正式 master 不变。
- 发布前需合并 #175、通过联合兼容性 CI、校验归档文件与 SHA256。

## English

- Inherit beta.2 progress, runtime resources and native workspace fixes.
- #174: independent Windows installer with immutable commit pinning and payload validation.
- #175: ZIP preflight, multi-copy rollback, persistent recovery journal, explicit offline recovery and unresolved-recovery admission guard.
- Backend restart verification distinguishes interruption, restart required and mismatched disk/backend. Actual renderer and Windows Desktop restart remain separate acceptance steps.
- Beta only. No stable promotion. ZIP transaction does not cover Git, profile configuration or subsequent host maintenance. Combined CI and archive verification are release gates.

# 1.1.92-wxcvm.7-beta.2

## 中文

- 版本切换新增实时后台阶段、真实下载字节/总量（未知则明确显示）、耗时及下载剩余时间估算，文件组进度和失败阶段；Git 与安装后维护异步化，状态查询不阻塞。防止同一操作重复提交，仍以重启后的实际版本为验收依据。
- 合并 Codex #173：自更新补齐 package.json 声明的运行资源（scripts、presets、skills、maintenance 等），避免安装版本与实际文件不一致。
- 原生最大化作战台扩展无模糊、实色滚动层到导航、测绘及其他页面，减少 Windows Chromium 局部绘制异常；真实桌面仍需复验，不改变旧浮窗或正式通道。
- 从 beta.1 继承全部改动，正式通道不变；首次从旧版进入新版仍使用旧界面。

## English

- Live version-switch stages, actual download bytes and download-only ETA, elapsed time, file-group progress and failure stage. Nonblocking Git and post-install maintenance keep polling responsive. Stable channel unchanged.
- Integrate Codex #173 runtime payload copy fix. Extend opaque, blur-free paint surfaces to the native maximized workspace, including navigation and survey cards. Windows desktop visual revalidation remains required.

# 1.1.92-wxcvm.7-beta.1

## 中文

- 从已经合并、已发布且维护者确认 Windows 实机验收的 .6（8470eec）继承完整代码。
- 修正版本交付：测试通道使用独立 `beta` 分支，版本递增为 .7-beta.1，使已经安装 .6 的用户能识别升级；正式通道 master 保留 .6，旧标签和资产不改动。
- rc.2 API 契约已经通过；声明宿主目标仍为 rc.1。此版本不改变运行时代码或客户端构建标识。新包仍需验证版本识别与安装链路。

## English

- Carry forward the verified .6 integration (8470eec) with a distinct .7 beta version and the actual beta branch update channel. Stable master and existing .6 release remain unchanged.
- No runtime changes. rc.2 API contracts passed on .6; declared target remains rc.1. Verify the new version identity and package before promotion.

# 1.1.92-wxcvm.6

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
