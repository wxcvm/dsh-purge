# 1.1.92-wxcvm.6

## 中文

- **管理桥接隐私**：修复本地回环请求绕过浏览器 Origin 检查的问题；远程 `/redteam/api` 需要显式配置 `DSH_PURGE_BRIDGE_TOKEN`，本机原有桌面行为保持兼容。令牌仅存在于页面内存，支持可选的本机强制认证。
- **暴露面状态**：「低干扰与隐私」页面展示 DSH 当前连接端点、服务端口、令牌配置及尚未验证的公网可达性；同时复用已验证的 ARTEX 本机健康探测，不读取 ARTEX 登录凭据。
- **本地资产库保护**：Linux/macOS 工作区目录与 SQLite 文件使用私有权限；Windows 增加明确选择才执行的 NTFS ACL 工具，默认仅预览，支持临时目录自动测试。
- **可选 AES-256-GCM 凭据字段加密**：用 `DSH_PURGE_SECRET_KEY` 加密新写入的 `credential.secret_value` 与 `webshell.pass_key`；旧库不自动迁移，提供只读数量预览及显式 `--apply` 事务迁移。修复加密后会话总览直接显示密文的问题。
- **可见的加密覆盖情况**：在现有隐私页面显示当前默认工作区内加密/明文记录的数量，不返回口令或密钥。
- **验证**：相关 PR #96、#97、#98、#99、#100、#101、#102、#103、#104、#105 已合并；所有对应的维护兼容性检查已通过。请区分 CI 与实际用户设备的安装验收。
- **仍未验证与限制**：Windows Desktop 真实升级/回滚、VPS 公网可达性、Docker 实际构建/部署，以及生产数据库迁移尚未完成。本功能不是整库加密；扫描原始证据、日志、报告、旧页/WAL、备份和导出仍可能含明文。远程桥接令牌不保护 DSH 主服务或其他插件接口。

## English

- Protect the Purge management bridge from cross-origin browser requests; require an explicit token for non-local `/redteam/api` access while preserving local desktop compatibility.
- Add truthful bridge, observed connection endpoint and ARTEX local-health status to the existing privacy panel. Do not misstate public network reachability.
- Restrict Linux/macOS workspace and SQLite file permissions; add an opt-in, preview-first Windows NTFS ACL utility.
- Add opt-in AES-256-GCM encryption for credential/WebShell fields and a read-only-preview / explicit-apply legacy migration. Fix encrypted WebShell keys in session summaries.
- Surface encrypted versus plaintext counts for the current default workspace without exposing actual secrets.
- All component PRs #96–#105 are merged and covered by their compatibility CI. Real user-machine deployment and release installation have not been validated.
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
