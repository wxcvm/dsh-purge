# Purge 本地 Windows CI（零额外托管计算费用）

本仓库的 Windows 兼容性矩阵和修复中心回归支持按仓库变量选择本机 Runner。默认仍走现有 GitHub 托管环境；只有注册完成并显式启用后才切换。Linux 矩阵及其他工作流暂保持不变，未降低测试标准。

## 一、在 Windows 11 注册

1. 在仓库 Settings → Actions → Runners → New self-hosted runner，选择 Windows / x64。
2. 建议用独立普通 Windows 账户；安装 Git for Windows（包含 Git Bash）和 PowerShell 7（pwsh），确认该账户可通过 HTTPS 访问 GitHub、官方 npm registry。Node.js 24 由原工作流 setup-node 准备；Windows .NET Framework 4.x 编译器用于原有 WinForms 测试。
3. 在该账户 PowerShell 中，按 GitHub 页面给出的当期下载、解压和注册命令执行。注册命令可追加 `--name purge-windows --labels purge-ci`（也可在 Runners 页面给该 Runner 添加 purge-ci 标签）。使用页面生成的短期注册 token，勿复制到聊天、日志或 Git 仓库。
4. 初次配置不安装为服务；运行 `.\run.cmd`，确认 Runner 页面显示 Idle，并存在 self-hosted、Windows、X64、purge-ci 标签。一次仅运行一个 Runner，保持电脑联网、开机、终端不退出。关闭终端可停止接收任务。

## 二、启用 Windows 路由

仓库 Settings → Secrets and variables → Actions → Variables → New repository variable，填写：

- Name: PURGE_WINDOWS_RUNNER
- Value: self-hosted

变量仅用于选择运行位置，不含凭据。未设置或删除变量时，Windows 与 Linux 仍使用原托管 Runner。仓库内 PR 和本仓库 push/dispatch 可选本机；fork PR 保留托管路由。不要让不信任的代码、第三方 PR 或依赖在日常账户的 Runner 中执行。独立账户不是完整虚拟机隔离。

## 三、验收

- 在 #254 最新提交运行 Maintenance compatibility 和 Repair center regression。Windows legacy / current 与修复回归应进入同一台 Runner 顺序执行；Linux 仍使用原托管矩阵。若旧工作流没有采用新路由，请确认实际运行对应本次提交并重新触发。
- Windows 保留全部七个固定宿主版本、generated client / syntax、WinForms 编译、更新器回滚、junction 和 ACL 检查。自托管节点直接复用本机 npm 下载缓存，不上传云端 npm cache；现有 Windows 编译产物上传步骤仍保留，受原存储额度约束。
- GitHub Runner 任务通过不等于真实桌面 GUI 或真实模型对照完成。GUI 与三组模型验收仍独立执行。
- 若 Linux 托管额度用尽，Linux 仍是未完成项；之后可另行接入 WSL2/Linux Runner，不把 Windows 测试冒充 Linux。
- 暂停：删除或改回变量（后续新任务恢复托管），并停止本地 Runner；已排队任务需要取消或重跑。若不再使用，在 Runners 页面移除注册。

官方说明：https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
