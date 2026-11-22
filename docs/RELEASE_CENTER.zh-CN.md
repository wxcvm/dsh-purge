# PURGE / 版本中心

[返回工作台](../README.md) · [Releases](https://github.com/wxcvm/dsh-purge/releases) · [Actions](https://github.com/wxcvm/dsh-purge/actions) · [开发进度](DEVELOPMENT_STATUS.zh-CN.md)

## 2026-11-22 · Stable .20 正式交付

- **实际发布**：[v1.1.92-wxcvm.20](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.20)，独立轻量标签指向 [`8fa76dda23a59984040c3af61a7134616c51d168`](https://github.com/wxcvm/dsh-purge/commit/8fa76dda23a59984040c3af61a7134616c51d168)，与发布工作流的 `head_sha` 一致；`.19` 等旧标签和资产未覆盖。
- **同提交主线 CI**：[Local Compatibility #45006809228](https://github.com/wxcvm/dsh-purge/actions/runs/45006809228) Windows/Ubuntu 两项通过；候选 [#485](https://github.com/wxcvm/dsh-purge/pull/485) 的 Windows/Ubuntu API 合约及双平台真实打包安装检查均通过；[Release #45007055483](https://github.com/wxcvm/dsh-purge/actions/runs/45007055483) completed/success。
- **GitHub 实际上传资产**：`dsh-purge-1.1.92-wxcvm.20.zip` 大小 **4,471,904 字节**，GitHub 资产 `digest` 为 `sha256:e06595448d5cd45b7d70dea9c2a4794178f06fd5bc86dd0a635be4d8571d89fe`；`SHA256SUMS.txt` 大小 96 字节，资产自身 `digest` 为 `sha256:c4960e3bfb0dcfd0387f3c4dfc2ae35ad6cf4e397f6c9a96932e0ac12022e7f4`。本轮通过 GitHub Release API 验证两个资产处于 `uploaded`，并核对标签、工作流同一提交；**没有宣称已独立下载并校验 ZIP 内容及 SHA256SUMS 的文本**。安装前请仍使用对应版本的校验文件核验本地下载。
- **本轮解决的交付缺口**：`.19` 资产没有 [#470](https://github.com/wxcvm/dsh-purge/pull/470) 的 Harness rc.5 Desktop Cookie 兼容和 [#482](https://github.com/wxcvm/dsh-purge/pull/482) 的旧客户端依赖修复；`.20` 新标签已打包这些主线代码，并合入 #484 的 Super Agent 刷新改善。具体改动见本版发行说明。
- **真实验收仍未完成**：用户当前 Windows Harness Desktop 从 `.19` 升级到 `.20`、关闭并重开后实际加载代码、作战台 `cross-origin request rejected` 是否解除、提示词页单独的 `local-only` 错误、首次 Provider 请求、后续回退与 ARTEX 双端联动仍须独立留证。CI 成功、上传成功、源码有修复均不等于这些运行时目标已通过。记录归 #336/#338/#340/#343。

> 下方是较早的历史快照，请勿把当时的 `.18` 或 `.19` 描述当作今日最新 Release。


> 本页为维护快照，不是自动更新接口。实际可下载版本、文件及校验值以对应 Release 为准。

## 历史 Release 查询快照 · 2026-11-21

| 渠道 | 版本 / 固定提交 | 实际核验 |
| --- | --- | --- |
| Stable | [v1.1.92-wxcvm.18](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.18) · [`0bd3a58`](https://github.com/wxcvm/dsh-purge/commit/0bd3a58ba1981c61193e898a2d1ba4f3517d7f5d) | ZIP 4,210,929 字节；SHA-256 `310ec43c2a0821ee1e266dc62e0be2ead876218a51b05b267e74c3501d4b75df`；下载、清单、GitHub 资产摘要与标签关键文件一致。 |
| Beta | [v1.1.92-wxcvm.7-beta.11](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.7-beta.11) · [`2c7ab65`](https://github.com/wxcvm/dsh-purge/commit/2c7ab6550953e27def091e641ce84cc11878fbe0) | ZIP 3,691,603 字节；SHA-256 `e1cefe83502b7a19cbb36a25ecf52ac0a52831589832f5165418db1805c9541e`；下载、清单、GitHub 资产摘要与标签关键文件一致。 |
| 主线源码（不是发布） | [`59df66b`](https://github.com/wxcvm/dsh-purge/commit/59df66b8ec3b1ba7cc883860a057287dc9910d0d) | [Windows / Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44901063903) 通过，含隔离 DSH_HOME 中的 npm 打包安装测试；.18 标签另有[发布提交 Windows / Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44724659602)。 |
| ARTEX 独立发行 | [v0.6.0](https://github.com/wxcvm/ARTEX/releases/tag/v0.6.0) · [`0a548c5`](https://github.com/wxcvm/ARTEX/commit/0a548c564bfd98036d78c4e011639eb369a2a9a4) | 下载 Windows Desktop ZIP 70,664,366 字节；SHA-256 `a0c0455d192c96b75c13d9f3367acb62cd408d4d70bdbb84b1698600fa698a43` 与该 Release 清单及 GitHub 资产摘要一致。没有运行 ARTEX 或验证双端协作。 |

### 重查已发布 Purge ZIP（只读）

在源码仓库的 Node.js 24 环境中，确保已有对应 Git 标签，并把 Release 下载的 ZIP 与 `SHA256SUMS.txt` 放在同一目录。例如核对正式版：

```powershell
node scripts/verify-release-artifact.mjs --tag v1.1.92-wxcvm.18 `
  --archive 'C:\downloads\dsh-purge-1.1.92-wxcvm.18.zip' `
  --checksums 'C:\downloads\SHA256SUMS.txt' `
  --commit 0bd3a58ba1981c61193e898a2d1ba4f3517d7f5d `
  --digest sha256:310ec43c2a0821ee1e266dc62e0be2ead876218a51b05b267e74c3501d4b75df
```

脚本不联网、不解包落盘、不运行归档代码。它核对资产名、SHA-256、标签提交、包名/版本及四个文件（`package.json`、`client.js`、`lib/index.js`、`lib/update.js`）与标签源码的字节一致性。不要把覆盖四个文件当成全包源码比对，也不等于签名、安装或运行验收；输出 `signatureVerified` 和 `runtimeVerified` 均为 `false`。

### 本机 Windows 安装只读对账（未验证已加载）

以主线 `748192d` 为比对基准：实读官方 Desktop `0.2.2-rc.5` 安装清单及必需 runtime 文件，Desktop profile 的磁盘插件声明 `1.1.92-wxcvm.18`，已存在打包入口与插入配置。显式只读跟随该 profile 的 DSH_HOME 内链接后，`lib/index.js`、`lib/prompt-profiles.js`、`client.js` 与主线不同；`lib/response-context.js`、`lib/prompt-assembly-router.js` 相同。所查的 Web / Default profile 位置没有插件。没有修改安装、启动/重启宿主或调用 Provider；不能判定正运行的 Desktop 加载了哪个副本。实际安装、更新回退、界面和 Provider 见 [#336](https://github.com/wxcvm/dsh-purge/issues/336)、[#337](https://github.com/wxcvm/dsh-purge/issues/337) 和 [#340](https://github.com/wxcvm/dsh-purge/issues/340)。

上游与后续进度见[总计划 0–8 项本轮对账](CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md#8--版本中心发布证据与远期研究)；每次发布都要重查对应候选提交，不沿用其他版本的结果。

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

同一检查还从当前检出的完整 Git 提交生成 ZIP，将默认包清单、前后端入口、更新器、维护入口和署名等 9 个文件与 npm 已解出的真实制品逐项比较，并报告两个归档各自的 SHA-256。非生成文本允许 Windows 检出时只发生 LF/CRLF 转换，并单独计数；生成的前端要求字节相等。该 ZIP 是候选证据，不创建标签、不上传资产、不视为已发布。

该检查不会运行 `postinstall`、启动 Harness Desktop、安装到用户已有目录、执行清洗补丁或发送真实 Provider 请求；完成后移除临时目录。**主线 `package.json` 的版本号只标识当前源码候选。即使和正式版同号，候选归档也不一定与已发布资产字节相同。** 只有以实际 Release 标签 / 资产 / SHA256 校验后，才能确认发布资产；真实 DSH_HOME 升级、Desktop 加载和 Provider 投递仍按 #336/#337/#340 单独记录。

### 2026-11-22 · 主线候选、公开 Release 和本机安装

- **源码候选**：[master @6dd19dc](https://github.com/wxcvm/dsh-purge/blob/6dd19dc90cc097223b3557ef1f67d5935fb62055/package.json) 是 `1.1.92-wxcvm.19`，[该提交 Windows/Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44927054025) 通过；这是该提交的证据，不适用于后续提交。
- **实际发布**：当日 [GitHub Releases](https://github.com/wxcvm/dsh-purge/releases) 的最新正式版仍是 [`v1.1.92-wxcvm.18`](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.18)。不能以源码版本或 CI 产物替代发布标签与实际资产。
- **本机磁盘和进程**：[只读核验](https://github.com/wxcvm/dsh-purge/issues/336#issuecomment-7066127454) 找到 Harness Desktop `0.2.2-rc.5` 和已登记的 Purge `.18`；插件前端字节与比较的 `.19` 候选不同。Desktop 有运行进程，但没有取得该进程加载候选版的证据。没有安装或重启，也没有发送 Provider 请求。

## Windows Runner 的只读 Desktop 证据（不等于已加载）

`scripts/inspect-windows-desktop-evidence.mjs` 在 Windows 自托管 Runner 上只读定位官方 Harness Desktop 的安装 exe 与 **app.asar 实际清单**、公共 runtime 文件，并以该 Runner 上的当前源码做逐文件哈希比较，分别检查 Desktop / Web / Default profile 的已安装 `dsh-purge`。既有 pnpm 安装产生的 junction 只有在解析目标属于当前 profile `node_modules/.pnpm`，或经结构验证的 DSH_HOME 共享 `profiles/node_modules/.pnpm/dsh-purge@*/node_modules/dsh-purge` 正规实体包目录时才读取；校验中会验证固定包名、层级、目录不为其他 symlink/junction，并且逐项拒绝任何进一步跳到该包目录以外的符号链接。未知/断开的链接不会跟随、不会读取目标包内容，只返回 `linkTargetScope` 的**预定义类别**（例如当前 profile 其他目录、DSH_HOME 其他目录、LocalAppData 或未知外部目录），不返回目标原始路径、路径片段或目录名。检测结果仅输出**布尔值、公开版本号、固定相对文件名及匹配/缺失状态**，不输出用户绝对路径、进程命令行、项目/会话内容、提示词正文、日志原文或任何凭据。

这个步骤仅在 `master` **push** 的 Windows Runner CI 执行（Pull Request 不读取机器环境），即使找不到 Desktop 也会给出“无证据”的真实状态，不自动修改/修复/启动/重启任何程序、不访问网络。运行进程计数是机器上的进程观察，并非运行时插件模块的证据：脚本明确报告 `runtimeLoadVerified: false`。安装磁盘文件与当前源码逐字节相同，也**不能证明已经重启并加载最新版本**。实际加载、开关生效、Provider HTTP、升级回退仍由 #336/#337/#340 的实机操作另行验收；观察结果也不能代替正式 Release 资产 SHA256。

### 2026-11-21 · DSH_HOME 共享 pnpm 目录对账规则

仓库中的 profile 安装脚本和 Windows junction 回退夹具均说明：`node_modules/dsh-purge` 可以是 junction，不能以“不是本 profile .pnpm 目录”推断损坏。新增的只读校验将同一 DSH_HOME 的**共享 profile 虚拟存储**列为第二个受信任布局，但仅在真实路径严格匹配 `profiles/node_modules/.pnpm/dsh-purge@*/node_modules/dsh-purge`，并且各级都是实体目录（而非再次跳转的链接）后才读取其**固定的插件代码文件和 package.json**。版本相等不代表代码相等；必须逐文件判定 `identical/different/missing`。共享目录下其他包、非标准文件夹、外部目录、断开的链接、嵌套逃逸和私人开发链接仍拒绝读取。整个过程不显示任何用户路径/正文/源码哈希，不进行安装或重启。

这个只读结果仍只代表 **Runner 磁盘上**的版本，不代表已运行 Desktop 的插件模块、Provider HTTP 内容或用户点击开关后的行为已验证。

### 2026-11-21 · 首轮 Runner 链接问题的后续判断

在 [master CI #44890697673](https://github.com/wxcvm/dsh-purge/actions/runs/44890697673) 的 Windows 只读样本中，官方 Desktop `0.2.2-rc.5` 的公开 runtime 文件完整，但 `desktop` profile 的 `dsh-purge` 为 `linked-uninspected`，只证明插件入口链接未满足当时的受信任 .pnpm 路径约束，**没有证明链接断开、插件版本不匹配或 Desktop 加载失败**。当轮进程匹配数为 0，同样无法推断下一次启动状态。后续只补链接出处的脱敏分类，绝不为了“看见版本”放开读取任意外部链接。需要版本/请求级证据时，须先在受控目录定位有效安装副本，或由已运行的授权宿主提供最小、明确的加载收据。

### 手动授权核验 DSH_HOME 内非标准链接（默认关闭）

如果 Windows Runner 自动探针继续显示 `linked-uninspected / inside-dsh-home-untrusted`，这**不能证明插件安装失败**。不要把所有 DSH_HOME 内的未知目录直接加入自动白名单。仓库现在提供仅由操作者主动触发的只读核验：

1. 打开 [Local Compatibility (Windows + WSL)](https://github.com/wxcvm/dsh-purge/actions/workflows/compatibility.yml)，选择 **Run workflow**，选择正式 `master`，勾选 **inspect_home_plugin_link**。默认不勾选，PR 与普通主线 push 绝不启用。
2. Windows Runner 将只在该项**明确开启**时，沿当前 desktop profile 的 `node_modules/dsh-purge` 已存在的链接，检查目标是否为 `DSH_HOME` 内的**实体目录**，且 `package.json` 必须声明 `name: dsh-purge`。仅读取这一包固定的代码文件进行源码逐字节比对；任何离开包目录的文件/目录 symlink 都拒绝哈希。外部于 DSH_HOME 的目标始终拒绝读取。
3. 结果依旧仅列公开版本号、固定文件相对名及 `identical/different/missing` 状态，**不包含**真实路径、个人配置、聊天记录、Prompt 正文、源文件字节或哈希值。也可在自己控制的 Windows 终端显式执行 `node scripts/inspect-windows-desktop-evidence.mjs --inspect-home-plugin-link`，脚本本身不写配置。

此选项授予的只是**读取 DSH_HOME 内链接所指插件代码文件**的临时权限，并非同意更新、重启 Desktop、清洗宿主、运行 Provider 或向云端发送本地私密数据。无论勾选与否，`runtimeLoadVerified` 仍为 `false`：插件磁盘字节一致不等于当前 Electron 进程已经加载该代码。#336 的真实 GUI 与 Provider 请求验收继续独立进行。

## 如何区分同版本的不同提交

「检查更新」仍按发布版本判断是否有可更新版本，不会因为同版本的分支提交变化就写入安装或请求重启。版本列表同时显示提交短号；本机记录只与实际对应的提交核对。当版本号相同但提交不同，界面单独说明差异；记录缺失时明确显示未核实。即使提交记录一致，也必须从宿主状态总览确认实际加载的前端构建和后端，不能从版本号或安装记录推出已加载。

### Harness Desktop 已打开，但页面提示 cross-origin request rejected

先区分官方 Harness 宿主版本、Purge 已安装版本、发布标签与当前源码。已发布的 [Purge .19](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.19) 标签对应提交 `ef10e66`，早于 [#470](https://github.com/wxcvm/dsh-purge/pull/470) 对官方 Harness `0.2.2-rc.5` Desktop 请求转发的兼容修复。因此重新安装同一份 .19 或仅重启它不会获得修复；主线上 `package.json` 仍可能同样显示 .19。

现有 Windows 只读探针也逐项比较请求路由、桥接鉴权和来源校验三个固定文件（`lib/redteam/ui.js`、`lib/redteam/bridge-auth.js`、`lib/redteam/bridge-origin.js`）。即使 `client.js` 和版本号完全一致，也能发现后端桥接代码不同。若已安装文件与包含 #470 的可信候选一致，仍需在实际 Desktop 完成正常退出重开，从宿主页面复查；不能从磁盘匹配推断页面恢复。不要为排障放开来源校验、复制会话凭据或使用其他宿主代验。

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

## 仓库访问与历史私有交付

- GitHub API 在 2026-11-21 返回仓库为公开、默认分支 `master`；当前发布资产从对应 Release 核对。过去转为 Private 的时段仍记在[开发进度历史快照](DEVELOPMENT_STATUS.zh-CN.md)，不作为当前说明。
- 私有仓库的授权下载与恢复属于独立兼容路径（[#268](https://github.com/wxcvm/dsh-purge/pull/268)）；公开资产核验不能证明该路径实机可用。私有资产需由已登录且有访问权限的账号下载，不能依赖匿名安装地址。
- 下载后核对 Release 的 SHA-256；没有校验文件不记为已通过。访问令牌不得写入发布文件、日志或文档。

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
