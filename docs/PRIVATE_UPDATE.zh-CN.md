# 私有仓库内置更新

本说明适用于包含私有更新授权修复的构建；旧 .6 与旧 Beta 安装不会仅因配置环境变量而获得此功能。

## 首次安装或从旧版升级（Windows）

旧版脚本默认匿名下载，私有仓库不能直接使用。登录 GitHub 后取得本仓库授权的 Release ZIP（或对应版本的源码归档），完整解压；从解压目录执行下面的命令。先完全退出目标 Harness，包括托盘或 Web 后端。

```powershell
$cache = Join-Path $env:USERPROFILE 'dsh-purge-packages'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
npm pack --ignore-scripts --pack-destination $cache
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$archive = Join-Path $cache "dsh-purge-$version.tgz"
powershell -ExecutionPolicy Bypass -File scripts/update-desktop-fork.ps1 -Profile desktop -LocalPackage $archive
powershell -ExecutionPolicy Bypass -File scripts/update-desktop-fork.ps1 -Profile desktop -CheckOnly
```

Web profile 改为 `-Profile web`；若定位不唯一，用 `-DshHome` 指向实际目录。保留本地 tgz（profile 可能仍引用它）。本地包在修改 profile 前核对名称、版本，不会重新匿名下载插件；其他依赖仍可能需要联网。若 CheckOnly 提示缺少 bundles/insert，按提示执行 ensure-profile-bundle.mjs 后再次检查。最后重启宿主并核对实际运行版本，再设置下节的令牌启用内置更新。首次真实安装尚需实机验收。

## 配置

1. 在 GitHub 创建仅限 `wxcvm/dsh-purge` 的细粒度访问令牌，Repository permissions → Contents: Read-only（Metadata 默认只读），设定适当有效期。
2. 在本机通过受信任的进程启动环境提供 `DSH_PURGE_GITHUB_TOKEN`，再完全退出并重新启动 Harness（Desktop 包括托盘；Web 重启实际后端）。不要把实际令牌写入仓库、profile YAML、命令历史、截图或诊断记录。仅在终端设置环境变量而从另一进程启动 Desktop 不保证传递。
3. 从清洗台检查更新，确认能读取 Stable/Beta 版本和提交；再执行版本切换。更新后依照更新验收区核对磁盘、后端进程重启及实际前端构建。

更新器通过 GitHub API 查询提交、标签、版本文件与指定提交的 ZIP，并通过 API 读取远端文件以核对目标。Authorization 只发往本仓库的 HTTPS API 路径；归档跳转到下载域时不转发 Authorization。不配置令牌时沿用旧公开访问路径；若远端不可读取，将报告访问失败，而非把本地历史误当作远端最新版本。

## 本地安装包缓存与 profile 迁移

对使用 profile 安装的私有更新，更新器在覆盖任何插件文件之前，先从 GitHub API 下载目标完整提交 SHA 对应的 tarball，验证包名及版本，并保存至 `<DSH_HOME>/dsh-purge/install-cache/dsh-purge-<完整SHA>.tgz`。旁边的 JSON 保存版本、提交、大小和 SHA-256；下次使用前重新检查文件，损坏则重新下载。令牌不写入缓存、收据或 profile。

私有模式不再自动将 profile 的依赖地址改成匿名 codeload，也不手改 pnpm 锁文件。更新收据 `profileInstall` 提供本地安装包路径及各 profile 是否需要迁移。当前阶段先保留原有 manifest/lockfile；因此已完成插件文件覆盖不代表 profile 已完成迁移。

### 使用独立迁移命令

使用已经包含本修复的插件源码或安装目录，完全退出要迁移的 Harness 宿主（Desktop 包括托盘，Web 包括实际后端），在插件目录执行：

```text
node scripts/migrate-private-profile.mjs <profile> <完整SHA> --host-stopped
```

Windows 需额外指定该 profile 实际使用的 pnpm 可执行文件或 JavaScript 入口，例如：

```text
node scripts/migrate-private-profile.mjs desktop <完整SHA> --host-stopped --pnpm "C:/path/to/pnpm.cjs"
```

完整 SHA 来自更新收据 `targetSha`，不是七位短提交号。命令会再次核验缓存，并只迁移指定的现有 profile。它先备份 package.json、pnpm-lock.yaml 和 pnpm-workspace.yaml（存在时），仅解析锁文件；核验来源后才执行冻结锁文件安装，最终核对实际安装包名称及版本。解析失败时尝试恢复原配置；若实际安装阶段失败，则保留已解析的配置与备份，报告 install_incomplete，不能宣称 node_modules 已回滚。可在宿主保持停止的情况下修复问题并重新运行命令。

`--host-stopped` 是操作者确认，不代表程序检测到了所有宿主进程。迁移不自动杀进程，不运行在内置更新请求里，不将 GitHub Token 传给 pnpm。安装阶段使用 --ignore-scripts，不执行依赖生命周期脚本；仍应按原安装文档检查 bundles、cordis insert 以及必要的构建审批。其他依赖可能需要网络，不能保证整次安装离线完成。迁移记录及备份保存在 `<DSH_HOME>/dsh-purge/profile-migrations/`，不要删除仍被 profile 引用的安装包。异常退出遗留的 `.dsh-purge-private-migration.lock` 只可在确认没有迁移进程、已检查备份和配置状态后手动清理。重启后仍需验收实际运行版本。


## 仍需验收

- Windows Desktop 与 Web 的真实授权网络、归档下载、版本切换和重启验收。
- 初次安装、实际 pnpm/profile 迁移及私有 Git checkout 凭据仍需分别验收；已实现本地安装包缓存和独立迁移命令，但运行中的更新器不会自动调用 pnpm；真实宿主迁移尚需验证，不替代 Git credential helper。
- 不会自动公开仓库、发布资产或提升 Beta。应先使用授权取得的新构建安装，再验证内置更新。

令牌过期、权限不足或网络中断时检查访问权限及进程环境。GitHub 对无权读取的私有仓库可能返回 404；不应据此认为仓库或测试版不存在。


## beta.8：界面检测与本机 Git 凭据

检测更新现在优先使用进程的 DSH_PURGE_GITHUB_TOKEN；没有显式令牌时，可通过本机已配置的 Git credential helper 非交互读取该仓库的访问材料，仅短时保存在内存。不调用 credential approve/store，不把令牌写入环境、profile、日志或前端。

网络优先使用 DSH_PURGE_UPDATE_PROXY / HTTPS_PROXY / ALL_PROXY；Windows 未指定时读取已启用的系统 HTTPS 代理。不会修改系统代理或 Node 全局网络设置。可用 DSH_PURGE_UPDATE_PROXY=direct 显式直连。诊断只返回代理是否启用及凭据来源，不返回代理认证内容或令牌。

清洗台原有“检测更新”请求同时返回只读上游观察。私有 fork 的更新渠道仍为 wxcvm/dsh-purge，原项目/Harness 检查不会自动覆盖二开。beta.8 的本机整合按用户要求不备份、不回滚，未使用上文旧迁移脚本；旧脚本的历史行为说明保留，不代表本次执行过它们。
