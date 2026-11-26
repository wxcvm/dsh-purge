# 内置更新中断恢复

**内置更新中途崩溃或强制退出（支持恢复日志的版本）：** 更新前的文件快照位于实际 `DSH_HOME/dsh-purge/update-recovery/copy-*`，每个目录的 `recovery.json` 记录已开始覆盖的文件组。完全退出 Desktop（含托盘）与 Web 后，从一份完整、可信的新版本源码包中运行 `node scripts/recover-update.mjs "<copy-目录>"` 查看状态，再加 `--restore` 恢复未完成的文件复制。不要从可能已损坏的安装目录执行。只恢复插件发布文件；不会自动撤销 Git、profile 配置或宿主维护，也不会在启动时自动改文件。已完成复制的记录不允许误回滚。

更新收据的 `verification` 区分 `interrupted`、`restart_required`、`disk_mismatch`、`backend_mismatch` 和 `backend_verified`。最后一项只确认后端启动身份和磁盘指纹；前端是否真的加载新版仍需检查实际界面构建标识。

新更新开始前会扫描上述恢复目录，存在 `copying`、`rollback_incomplete` 或无法读取的恢复日志时拒绝继续，以免覆盖恢复依据。已完成/已恢复的记录不阻挡更新。可用 `node scripts/recover-update.mjs --list "<实际DSH_HOME>/dsh-purge/update-recovery"` 只读列出待处理记录；先检查路径再按上文恢复。若日志本身损坏，请保留完整备份并人工核对，勿直接删除。
