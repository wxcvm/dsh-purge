# 私有仓库内置更新

本说明适用于包含私有更新授权修复的构建；旧 .6 与旧 Beta 安装不会仅因配置环境变量而获得此功能。

## 配置

1. 在 GitHub 创建仅限 `wxcvm/dsh-purge` 的细粒度访问令牌，Repository permissions → Contents: Read-only（Metadata 默认只读），设定适当有效期。
2. 在本机通过受信任的进程启动环境提供 `DSH_PURGE_GITHUB_TOKEN`，再完全退出并重新启动 Harness（Desktop 包括托盘；Web 重启实际后端）。不要把实际令牌写入仓库、profile YAML、命令历史、截图或诊断记录。仅在终端设置环境变量而从另一进程启动 Desktop 不保证传递。
3. 从清洗台检查更新，确认能读取 Stable/Beta 版本和提交；再执行版本切换。更新后依照更新验收区核对磁盘、后端进程重启及实际前端构建。

更新器通过 GitHub API 查询提交、标签、版本文件与指定提交的 ZIP，并通过 API 读取远端文件以核对目标。Authorization 只发往本仓库的 HTTPS API 路径；归档跳转到下载域时不转发 Authorization。不配置令牌时沿用旧公开访问路径；若远端不可读取，将报告访问失败，而非把本地历史误当作远端最新版本。

## 仍需验收

- Windows Desktop 与 Web 的真实授权网络、归档下载、版本切换和重启验收。
- 初次安装、Harness 自身的 pnpm/profile 重新安装与私有 Git checkout 的凭据仍分别依赖相应安装方式；本修复不将令牌写入 profile URL，也不替代 Git credential helper。
- 不会自动公开仓库、发布资产或提升 Beta。应先使用授权取得的新构建安装，再验证内置更新。

令牌过期、权限不足或网络中断时检查访问权限及进程环境。GitHub 对无权读取的私有仓库可能返回 404；不应据此认为仓库或测试版不存在。
