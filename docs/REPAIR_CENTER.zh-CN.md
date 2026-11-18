# 常见故障诊断与修复

位置：Purge → 诊断中心 → 常见故障诊断与修复 → 检查常见故障。

| 项目 | 检查 | 可执行修复 |
|---|---|---|
| 公共更新运行时 | Node/pnpm/CLI/版本文件 | 从本机同版本缓存验证并补齐缺失文件，不执行安装器、不覆盖既有文件 |
| 桌面宿主加载布局 | 物理 ASAR、解包目录及版本差异；不推断正在运行的进程 | 只读报告，不移动 ASAR 或目录 |
| 全局/桌面启动配置 | YAML语法和顶层数组 | 只对空文件或仅注释的null文档补[]，保留注释并先备份 |
| 插件安装配置 | pnpm-workspace.yaml，包含重复键 | 有冲突只报告，不合并含义不明的值 |
| 历史载入卡顿 | 已知的可选stream组件空缓冲超时循环 | 只移动超时状态转换；不新增或启用该组件，不改其他判断 |
| 安装载荷/注册 | 必需文件、桌面bundle注册 | 只报告缺失，不抹掉现有插件或配置 |
| 实际插件加载 | 已启用插件的Host状态 | 只报告，不自动停用插件 |

修复需逐项点击，执行前会检查运行任务/维护状态；只读检查不受影响。界面不触发模型请求，不删会话，不重置账号，不递归清理安装目录。

## 独立 CLI

宿主启动失败或主线程已阻塞时，仍可在终端运行：

```
node "[PURGE]/bin/dsh-purge.js" --repair-status --exe "[HARNESS_EXE]"
node "[PURGE]/bin/dsh-purge.js" --repair global-patch
node "[PURGE]/bin/dsh-purge.js" --repair profile-patch
node "[PURGE]/bin/dsh-purge.js" --repair runtime --exe "[HARNESS_EXE]"
node "[PURGE]/bin/dsh-purge.js" --repair stream-timeout
node "[PURGE]/bin/dsh-purge.js" --repair-rollback "[RECEIPT_ID]"
```

配置/可选组件修复备份位于 DSH_HOME/purge-repairs/UUID；回滚会核对当前文件与备份哈希，拒绝覆盖后续改动。运行时恢复单独使用 purge-runtime-recovery 来源及逐文件记录；不提供自动删除已恢复运行时的按钮。

代码修复落盘不等于运行中的生成器已替换：stream-timeout结果明确标记 restartRequired。请等当前任务结束后重载或正常退出重启。死循环已占住主线程时，网页接口同样可能不可用；CLI可以先修磁盘代码，但不冒充已经解除了当前循环。

## 已纳入本轮的修复

- 官方更新读取发布版本字符串，不再把Windows数字PE元组直接与rc版本比较；安装后与修复中心一致检查六个关键运行时文件，不把安装器退出0单独当完整安装。若安装未通过验收且可执行文件版本已改变，保留当前归档与旧解包目录，不恢复旧应用到新版本，也不由更新助手再次启动；日志记录 manual-recovery-required。
- 同版本缓存运行时恢复、诊断API和界面入口。
- 全局仅注释patch文档的启动恢复。
- 本机历史加载卡顿的空缓冲超时状态机修复，可选组件不在某些仓库版本中；维护补丁同时保存在 maintenance/fixes/stream-empty-timeout.patch，不整包带入未提交组件。

不改独立第三方商城源码；已安装商城的兼容补丁应向对应仓库提交。未把归档403、外部记忆后端缺失或账号登录问题统一当成配置损坏；这些问题不通过删除数据或放开访问限制来“修复”。
