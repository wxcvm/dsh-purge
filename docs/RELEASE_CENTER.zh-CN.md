# PURGE / 版本中心

[返回工作台](../README.md) · [Releases](https://github.com/wxcvm/dsh-purge/releases) · [Actions](https://github.com/wxcvm/dsh-purge/actions) · [开发进度](DEVELOPMENT_STATUS.zh-CN.md)

> 本页为维护快照，不是自动更新接口。实际可下载版本、文件及校验值以对应 Release 为准。

## 当前 Release 查询快照 · 2026-11-20

| 渠道 | 最新可见版本 | 证据与边界 |
| --- | --- | --- |
| 最新 Release | [v1.1.92-wxcvm.18](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.18) | 对应 [`0bd3a58`](https://github.com/wxcvm/dsh-purge/commit/0bd3a58ba1981c61193e898a2d1ba4f3517d7f5d)，已下载 ZIP 与 SHA256SUMS，校验、包内版本和入口通过（见下） |
| 当前 master | [提交历史](https://github.com/wxcvm/dsh-purge/commits/master/) | [发布提交 Windows / Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44724659602) 已通过；后续主分支改动与旧发布包不混同 |
| 实际安装 / Provider | [#336](https://github.com/wxcvm/dsh-purge/issues/336) | 另行验收，不从版本字段、CI 或 Release 可见性推断 |

已校验发布 ZIP 的 SHA-256：`310ec43c2a0821ee1e266dc62e0be2ead876218a51b05b267e74c3501d4b75df`。下载字节、包内清单与版本通过，不等于已安装或已加载。

有关上游接手版和 Codex 实施：[根目录 AGENTS.md](../AGENTS.md)、[上游吸收执行方案](CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md)。发布前仍须执行当前提交的打包、干净配置、Windows Desktop / Web 安装与恢复检查，不能拿 CI 或 .11 的校验结果替代。

## .11 历史验证快照 · 2026-11-18

| 渠道 | 版本 | 状态 |
| --- | --- | --- |
| Stable | [1.1.92-wxcvm.11](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.11) | 已发布；ZIP、SHA-256 与提交 `00975bf` 已核对，安装与重启待实机验收 |
| Stable 历史版本 | [1.1.92-wxcvm.10](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.10) | GitHub 已列出 Release；本轮未重新核对其资产字节 |
| Stable 历史版本 | [.6–.9](https://github.com/wxcvm/dsh-purge/releases) | 仅按各标签及实际 Release 记录判断，不套用 .11 的验收结果 |
| Beta | [独立分支](https://github.com/wxcvm/dsh-purge/blob/beta/package.json) | 以该分支与实际 Release 为准，不自动提升为 Stable |

[.11 交付台账](DELIVERY_STATUS_11.zh-CN.md)分别记录发布资产、本地打包、自动化检查和待实机项。这份工作副本上的诊断修复尚未发布，原标签与资产未修改。

## 发布候选包的干净目录自动验收（非 Desktop 实机）

`scripts/check-packlist.mjs` 仅校验 npm 将打包哪些文件；`scripts/smoke-packed-install.mjs` 进一步从**当前候选源码**实际执行 `npm pack`，校验 tgz 的 npm SHA-1 / SHA-512 元数据与真实归档一致，在全新、可销毁的临时 `DSH_HOME` 内安装该 tgz，验证包内版本、关键文件、五个 Host 插件模块导入（作战台工具模块通过已单独安装并校验的官方 rc.5 宿主夹具解析完整依赖，测试本身不重复安装宿主依赖）、生成客户端语法和 CLI `--help`。Windows / Ubuntu 的兼容性 CI 均执行该步骤，失败不允许把当前候选标记为打包验收成功。

该检查不会运行 `postinstall`、启动 Harness Desktop、安装到用户已有目录、执行清洗补丁或发送真实 Provider 请求；完成后移除临时目录。**当前主线 package.json 的版本号仍对应上一正式版，不表示从当前主线生成的候选归档就是已发布 .18 的相同字节。** 只有以实际 Release 标签 / 资产 / SHA256 校验后，才能确认发布资产；真实 DSH_HOME 升级、Desktop 加载和 Provider 投递仍按 #336/#337/#340 单独记录。

## Windows Runner 的只读 Desktop 证据（不等于已加载）

`scripts/inspect-windows-desktop-evidence.mjs` 在 Windows 自托管 Runner 上只读定位官方 Harness Desktop 的安装 exe 与 **app.asar 实际清单**、公共 runtime 文件，并以该 Runner 上的当前源码做逐文件哈希比较，分别检查 Desktop / Web / Default profile 的已安装 `dsh-purge`。既有 pnpm 安装产生的 junction 只有在解析目标属于当前 profile `node_modules/.pnpm`，或经结构验证的 DSH_HOME 共享 `profiles/node_modules/.pnpm/dsh-purge@*/node_modules/dsh-purge` 正规实体包目录时才读取；校验中会验证固定包名、层级、目录不为其他 symlink/junction，并且逐项拒绝任何进一步跳到该包目录以外的符号链接。未知/断开的链接不会跟随、不会读取目标包内容，只返回 `linkTargetScope` 的**预定义类别**（例如当前 profile 其他目录、DSH_HOME 其他目录、LocalAppData 或未知外部目录），不返回目标原始路径、路径片段或目录名。检测结果仅输出**布尔值、公开版本号、固定相对文件名及匹配/缺失状态**，不输出用户绝对路径、进程命令行、项目/会话内容、提示词正文、日志原文或任何凭据。

这个步骤仅在 `master` **push** 的 Windows Runner CI 执行（Pull Request 不读取机器环境），即使找不到 Desktop 也会给出“无证据”的真实状态，不自动修改/修复/启动/重启任何程序、不访问网络。运行进程计数是机器上的进程观察，并非运行时插件模块的证据：脚本明确报告 `runtimeLoadVerified: false`。安装磁盘文件与当前源码逐字节相同，也**不能证明已经重启并加载最新版本**。实际加载、开关生效、Provider HTTP、升级回退仍由 #336/#337/#340 的实机操作另行验收；观察结果也不能代替正式 Release 资产 SHA256。

### 2026-11-21 · DSH_HOME 共享 pnpm 目录对账规则

仓库中的 profile 安装脚本和 Windows junction 回退夹具均说明：`node_modules/dsh-purge` 可以是 junction，不能以“不是本 profile .pnpm 目录”推断损坏。新增的只读校验将同一 DSH_HOME 的**共享 profile 虚拟存储**列为第二个受信任布局，但仅在真实路径严格匹配 `profiles/node_modules/.pnpm/dsh-purge@*/node_modules/dsh-purge`，并且各级都是实体目录（而非再次跳转的链接）后才读取其**固定的五个插件代码文件和 package.json**。版本相等不代表代码相等；必须逐文件判定 `identical/different/missing`。共享目录下其他包、非标准文件夹、外部目录、断开的链接、嵌套逃逸和私人开发链接仍拒绝读取。整个过程不显示任何用户路径/正文/源码哈希，不进行安装或重启。

这个只读结果仍只代表 **Runner 磁盘上**的版本，不代表已运行 Desktop 的插件模块、Provider HTTP 内容或用户点击开关后的行为已验证。

### 2026-11-21 · 首轮 Runner 链接问题的后续判断

在 [master CI #44890697673](https://github.com/wxcvm/dsh-purge/actions/runs/44890697673) 的 Windows 只读样本中，官方 Desktop `0.2.2-rc.5` 的公开 runtime 文件完整，但 `desktop` profile 的 `dsh-purge` 为 `linked-uninspected`，只证明插件入口链接未满足当时的受信任 .pnpm 路径约束，**没有证明链接断开、插件版本不匹配或 Desktop 加载失败**。当轮进程匹配数为 0，同样无法推断下一次启动状态。后续只补链接出处的脱敏分类，绝不为了“看见版本”放开读取任意外部链接。需要版本/请求级证据时，须先在受控目录定位有效安装副本，或由已运行的授权宿主提供最小、明确的加载收据。

### 手动授权核验 DSH_HOME 内非标准链接（默认关闭）

如果 Windows Runner 自动探针继续显示 `linked-uninspected / inside-dsh-home-untrusted`，这**不能证明插件安装失败**。不要把所有 DSH_HOME 内的未知目录直接加入自动白名单。仓库现在提供仅由操作者主动触发的只读核验：

1. 打开 [Local Compatibility (Windows + WSL)](https://github.com/wxcvm/dsh-purge/actions/workflows/compatibility.yml)，选择 **Run workflow**，选择正式 `master`，勾选 **inspect_home_plugin_link**。默认不勾选，PR 与普通主线 push 绝不启用。
2. Windows Runner 将只在该项**明确开启**时，沿当前 desktop profile 的 `node_modules/dsh-purge` 已存在的链接，检查目标是否为 `DSH_HOME` 内的**实体目录**，且 `package.json` 必须声明 `name: dsh-purge`。仅读取这一包固定的五个代码文件进行源码逐字节比对；任何离开包目录的文件/目录 symlink 都拒绝哈希。外部于 DSH_HOME 的目标始终拒绝读取。
3. 结果依旧仅列公开版本号、固定文件相对名及 `identical/different/missing` 状态，**不包含**真实路径、个人配置、聊天记录、Prompt 正文、源文件字节或哈希值。也可在自己控制的 Windows 终端显式执行 `node scripts/inspect-windows-desktop-evidence.mjs --inspect-home-plugin-link`，脚本本身不写配置。

此选项授予的只是**读取 DSH_HOME 内链接所指插件代码文件**的临时权限，并非同意更新、重启 Desktop、清洗宿主、运行 Provider 或向云端发送本地私密数据。无论勾选与否，`runtimeLoadVerified` 仍为 `false`：插件磁盘字节一致不等于当前 Electron 进程已经加载该代码。#336 的真实 GUI 与 Provider 请求验收继续独立进行。

## 后续发布预检

- 固定候选提交，确认包内版本、标签、必要运行文件和 SHA-256。已发布版本不使用相同标签替换资产。
- `dry_run: true` 可在授权的发布工作流中只做归档检查；预检日志不能替代实际下载资产校验。核对候选提交上的 CI，不借用其他提交的结果。
- Windows Desktop 与 Web 独立记录干净配置安装、现有配置升级、重启重连和故障恢复。真实宿主未跑时明确写「未验收」。

## 如何判断版本状态

| 阶段 | 核对位置 | 完成条件 |
| --- | --- | --- |
| 1. 源码 | package.json、目标分支 | 版本号及提交确定 |
| 2. CI | [Actions](https://github.com/wxcvm/dsh-purge/actions) | 对应提交的必要构建与测试通过 |
| 3. 标签 | [Tags](https://github.com/wxcvm/dsh-purge/tags) | 标签指向预期提交 |
| 4. Release | [Releases](https://github.com/wxcvm/dsh-purge/releases) | 目标版本发布，正确资产及校验文件可访问 |
| 5. 实机 | 验收记录 | 对应宿主、安装方式、版本与真实运行结果有记录 |
| 6. Stable 提升 | [Pull requests](https://github.com/wxcvm/dsh-purge/pulls) | 明确批准并完成目标分支合并 |

预览版不自动等于正式版。不要用旧版本的验收结果替代新版本实机验收。

## 私有交付

- 在已登录且具备仓库权限的 GitHub 会话中访问 Releases，选择明确的版本和实际上传资产。
- 若版本提供 SHA256SUMS，下载后核对相应文件的 SHA-256；没有校验文件时不记录为已完成校验。
- 匿名安装地址和 codeload URL 不能直接访问私有仓库。#268 已合并授权更新与恢复实现；实际安装、升级和重启结果仍需核验。参见 [更新恢复](UPDATE_RECOVERY.zh-CN.md)。
- GitHub 访问令牌不得写入发布文件、日志或仓库文档。

## 发布与验收记录模板

复制以下字段到每次发布说明或对应 PR，未验证项标为待确认，失败项记录具体结果。

| 字段 | 记录 |
| --- | --- |
| 版本 / 渠道 | 待填写 |
| 源码提交 / 标签 | 待填写 |
| CI 链接 / 结论 | 待填写 |
| Release 链接 / 资产 / SHA-256 | 待填写 |
| Windows Desktop 宿主版本 / 验收 | 待填写 |
| Web 宿主版本 / 验收 | 待填写 |
| 安装、更新、版本切换、重启 | 待填写 |
| 已知问题 / 回滚版本 | 待填写 |

维护约定：每次版本发布或 Stable 提升后更新本页快照；无发布变更的文档 PR 不修改版本号。
