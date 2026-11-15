# Purge 本地双端 CI（Windows + WSL）

日常 PR 和 master/beta push 由 Maintenance compatibility 的 Windows 与 Linux 两个任务运行最新官方 DSH fixture、完整回归及构建检查；Windows 额外执行现有更新器、junction、NTFS ACL 和 WinForms 检查。修复中心测试已经包含在完整回归内；Linux 同一任务另执行 Pending specs，其失败独立显示警告，不改变主测试失败判定。

## Runner

- Windows：注册 Windows/x64 Runner，添加 purge-ci 标签，运行 `run.cmd`。需要 Git for Windows、PowerShell 7 和原有 WinForms 编译环境。
- WSL：注册 Linux/x64 Runner，添加 purge-ci 标签，运行 `./run.sh`。建议安装到 Linux 文件系统内。
- 两台 Runner 都由 setup-node 提供 Node.js 24，使用本机 npm 下载缓存。仓库内 PR 和 push/dispatch 使用本机；fork PR 保留 GitHub 托管路由。不要把不信任的代码放到个人机器执行。
- 不再需要 PURGE_WINDOWS_RUNNER 变量。Windows 与 WSL 各自使用自托管 Runner 标签。可在仓库变量设置 PURGE_CI_TEST_CONCURRENCY 指定测试工作进程数，默认取当前系统可用并行度。

## 验收与暂停

- 日常只运行两个自动任务，Repair center regression 和 Pending specifications 保留手动运行入口，便于专项复测。
- 在 Actions 检查主测试结论和 Pending specs 的单独结果。Pending specs 未执行不代表通过。
- 真实 GUI 与模型验收仍需独立验证；本地 CI 不自动运行模型。
- 暂停时停止 Runner 进程；已排队任务需在 Actions 取消。注册 token 不应进入日志、聊天或仓库。

官方说明：https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
