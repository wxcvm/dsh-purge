# 私有仓库内置更新

本说明适用于包含私有更新授权修复的构建；旧 .6 与旧 Beta 安装不会仅因配置环境变量而获得此功能。

## 配置

1. 在 GitHub 创建仅限 `wxcvm/dsh-purge` 的细粒度访问令牌，Repository permissions → Contents: Read-only（Metadata 默认只读），设定适当有效期。
2. 在本机通过受信任的进程启动环境提供 `DSH_PURGE_GITHUB_TOKEN`，再完全退出并重新启动 Harness（Desktop 包括托盘；Web 重启实际后端）。不要把实际令牌写入仓库、profile YAML、命令历史、截图或诊断记录。仅在终端设置环境变量而从另一进程启动 Desktop 不保证传递。
3. 从清洗台检查更新，确认能读取 Stable/Beta 版本和提交；再执行版本切换。更新后依照更新验收区核对磁盘、后端进程重启及实际前端构建。

更新器通过 GitHub API 查询提交、标签、版本文件与指定提交的 ZIP，并通过 API 读取远端文件以核对目标。Authorization 只发往本仓库的 HTTPS API 路径；归档跳转到下载域时不转发 Authorization。不配置令牌时沿用旧公开访问路径；若远端不可读取，将报告访问失败，而非把本地历史误当作远端最新版本。

## 本地安装包缓存与 profile 迁移

对使用 profile 安装的私有更新，更新器在覆盖任何插件文件之前，先从 GitHub API 下载目标完整提交 SHA 对应的 tarball，验证包名及版本，并保存至 `<DSH_HOME>/dsh-purge/install-cache/dsh-purge-<完整SHA>.tgz`。旁边的 JSON 保存版本、提交、大小和 SHA-256；下次使用前重新检查文件，损坏则重新下载。令牌不写入缓存、收据或 profile。

私有模式不再自动将 profile 的依赖地址改成匿名 codeload，也不手改 pnpm 锁文件。更新收据 `profileInstall` 提供本地安装包路径及各 profile 是否需要迁移。当前阶段先保留原有 manifest/lockfile；因此已完成插件文件覆盖不代表 profile 已完成迁移。

如果需要重装或修复依赖，完全退出对应 Harness 宿主，备份该 profile 的 package.json 和 pnpm-lock.yaml（若存在），使用该 profile 实际采用的 pnpm 在其目录执行 `pnpm add "<本地缓存 .tgz 的完整路径>"`，由包管理器同时更新依赖声明和锁文件。依赖包可能仍需网络；本地缓存只消除了 Purge 私有 GitHub 安装包的匿名下载依赖。按原有安装文档处理 postinstall 审批，并重新核对安装版本、bundles 与 cordis insert。不要把本地归档删除；profile 可能仍引用该文件。尚未完成 Windows/Desktop 实机验证，不建议在运行中的宿主上执行 pnpm。

## 仍需验收

- Windows Desktop 与 Web 的真实授权网络、归档下载、版本切换和重启验收。
- 初次安装、实际 pnpm/profile 迁移及私有 Git checkout 凭据仍需分别验收；已实现本地安装包缓存，但没有自动执行 pnpm，也不替代 Git credential helper。
- 不会自动公开仓库、发布资产或提升 Beta。应先使用授权取得的新构建安装，再验证内置更新。

令牌过期、权限不足或网络中断时检查访问权限及进程环境。GitHub 对无权读取的私有仓库可能返回 404；不应据此认为仓库或测试版不存在。
