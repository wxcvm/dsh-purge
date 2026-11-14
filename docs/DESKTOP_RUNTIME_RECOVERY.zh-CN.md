# 桌面插件更新运行时：诊断与缺失恢复

入口：Purge → 诊断中心 → 桌面插件更新运行时。

- 检查更新运行时：只读检查物理安装目录中的 Node、pnpm、CLI、版本清单，优先读取真实 app.asar 的桌面版本，避免旧解包目录误导。
- 恢复缺失运行时：只使用本机 pending/update-info.json 对应缓存，校验 SHA512、缓存版本与包内实际版本后，使用已有 7-Zip 提取文件；不执行安装器、不下载、不升级、不覆盖已有文件、不重启、不修改会话或账号。
- 活跃任务/插件安装时暂不恢复。遇到不同版本、链接目录、损坏缓存会明确报错，不混用运行时。
- 恢复目录位于 DSH_HOME/purge-runtime-recovery/时间-UUID；source.json 记录来源，files.jsonl 记录每个文件写入意图，receipt.json 记录最终成功或失败。中途失败保留已补文件及记录，不删除既有文件。
- 关键文件存在不等于全部功能正常；检查不执行模型请求。历史更新日志中的数字版本误判会标为历史证据，不能由运行时缺失推断是谁删除了文件。

CLI：
```
node "[PURGE]/bin/dsh-purge.js" --desktop-runtime-status --exe "[HARNESS_EXE]"
node "[PURGE]/bin/dsh-purge.js" --repair-desktop-runtime --exe "[HARNESS_EXE]"
```
GET /dsh-purge/desktop-runtime 返回只读快照。
POST 同一路由，JSON {"action":"restore-missing"} 触发恢复，沿用现有本机访问与同源检查。

同时修正官方更新 WSH 的版本读取：FSO.GetFileVersion 的数字 PE 版本不能直接和发布版本比较；通过 .NET FileVersion 读取实际发布字符串后校验，并检查安装后关键运行时文件。未实测执行一次完整主程序升级，不声称升级全链路已验收。
