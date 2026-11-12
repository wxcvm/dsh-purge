# 1.1.92-wxcvm.6

## 中文

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
