# Harness Maintenance Tools 0.1.2

适配已经验证的 Harness 0.2.2-rc.1 / Cordis 4.1.0。独立维护工具包；不包含其他插件源代码，不改 system prompt，不注册额外宿主权限，不访问网络、用户目录、Shell 或生产数据库。

## 接口

| 名称 | 行为 |
|---|---|
| maintenance_validate_records | 校验显式传入的 JSON 记录，返回状态计数 |
| maintenance_export_report | 将同一记录渲染为 Markdown / JSON 文本；不会自行写文件 |
| maintenance_replay_records | 按时间查看记录，并返回可用于续接的当前任务、待办、阻塞及已完成记录；同时间保持输入顺序，不执行记录内容 |
| maintenance_template_catalog | 列出六类普通任务模板，或按 ID 取一个模板 |

记录结构为 schemaVersion: 1、records 数组；每条包含 id、title、status、updatedAt，以及可选 summary。状态是 todo、doing、done、blocked。时间使用 UTC 的 ISO 8601，摘要多行请用 LF。只处理显式提供的普通记录，不要传入凭据或私密原文。单次最多 128 KiB、100 条。

JSON 示例：

    {"schemaVersion":1,"records":[{"id":"case-1","title":"示例","status":"done","updatedAt":"2026-11-04T12:00:00Z","summary":"合成数据"}]}

本地 CLI 可运行 catalog / template ID / validate / replay / resume / report markdown|json。记录通过 stdin 传入，结果写 stdout。可由用户自行将输出保存为文件。CLI 不装入 Harness，也不创建额外 profile。

## 长任务续接

将明确记录的任务 JSON 保留在你自己的工作区。后续会话可以使用 `maintenance_replay_records` 读取同一份 JSON，或通过本地 CLI 的 `resume` 输出当前进行中、待办、受阻和已完成列表。续接结果保留记录 ID、标题、摘要和更新时间，使用显式状态，不推断任务完成、不自动选择或执行下一步，也不改写宿主上下文。已完成记录不会进入待办列表。记录保存与更新由用户或其正常工作流负责，本包不自动读取会话历史。

## 子智能体任务交接（V7）

如需将子智能体执行结果关联到普通任务记录，在 `redteam_agent_slot` 的 `acquire` 中使用任务记录的 `id` 作为稳定 `key`；随后通过 `redteam_agent_slot(action=status)` 获取同一主会话的当前预留和最近结束交接信息。将该响应 JSON 作为 `maintenance_replay_records` 的可选 `coordination` 参数传入即可获得 `resume.delegation.tasks`：

- `reserved`：已占名额、尚未关联子运行；`delegated`：已关联子运行，不能据此断定任务正在运行
- `needs-verification`：子运行正常结束且存在最终回复，但没有独立任务验收证据
- `needs-attention`：异常/未知结束或最终回复缺失，需要进一步判断
- `no-linked-evidence`：没有匹配的运行记录；不能据此认定从未执行
- `recorded-done`：来自用户显式任务记录的完成状态，不代表工具已验收

仅按同一任务拥有者的精确 `id/key` 关联；不会自动更新 `done`、重新派工或执行任何任务。最近结束交接信息可写入靶标工作区内的 `agent-handoffs.json`，通过现有原子文件替换方式保存，且只包含主会话标识、任务键、结束原因与消息存在性。用户重启后再查询同一根会话的状态，可恢复最近最多 200 条交接记录；不会恢复已占的并发名额、自动派工或存储回复正文。若 `handoff_storage` 不是 `ready`，表示本地恢复/持久化不可用，此时只以当前进程内的记录为准。进程之间同时写同一工作区时未提供跨进程事务合并。若有多个会话/靶标，应分别传入相应范围的状态，不能跨会话混合。

## 对照口径

- 旧镜像与工作区已有报告导出和任务校验功能；不重复移植旧演练库。这里的输入是普通结构化记录，不读取、覆盖或迁移现有演练数据库。
- 会话内目录只列出本包普通模板。另有仅限本地 CLI 的 skills ABSOLUTE_DIR：只看显式提供目录下一层的 SKILL.md 文件元数据，不读正文、不跟随链接、不注册技能。
- 报告回放只读展示，不支持执行历史命令。原生补丁和定时任务提示段继续由 Harness 管理。
- 不含模型拒答、宿主认证、审批、沙箱或目标访问控制的改写。

生产目标是当前 desktop profile。未验收的宿主版本不会按兼容版本部署；这个包没有安装脚本或自动更新钩子。
