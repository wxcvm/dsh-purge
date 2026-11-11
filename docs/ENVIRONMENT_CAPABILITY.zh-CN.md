# 多环境与工具能力适配：第一阶段

此阶段仅增加环境与工具能力的**只读事实层**，不替换现有作战工作流，不增加工具，不要求用户重新配置。

## 已实现

- `environmentList`：列出当前 Node 进程所在本机。不能据此推断已连接 WSL、Kali VM 或 Docker。
- `environmentDiagnose`：只读定位内置 17 个工具的路径，返回每个工具的来源、状态与诊断建议。**不执行版本命令，也不对目标发送请求**。
- `capabilityProbe`：用户显式传入内置工具 ID 后，使用既有版本探针检查本机二进制文件。不能提交任意命令或路径。
- 旧接口 `platformConfigGet`、`platformToolProbe`、`platformTaskPlan` 继续可用；旧 `envAdaptStatus.ready` 保持会话入口兼容语义，不能当作工具能力就绪依据。

## API 响应状态定义

| 状态 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| `missing` | 当前解析规则未发现工具文件 | 系统其他环境一定没有此工具 |
| `located` | 当前本地解析规则找到了工具文件 | 程序可运行、依赖齐全 |
| `probe_verified` | 显式版本探针成功运行 | 任务能力完整、目标已测试 |
| `degraded` | 探针失败/超时 | 工具必然无法通过其他方式工作 |
| `capability_verified` | 预留，必须完成明确的依赖检查后才可使用 | 目标任务已执行 |
| `executed` | 预留，必须由真实执行记录证明 | 仅凭检测状态不可标注 |

当前接口的 `capabilityVerified` 固定为 `false`，`executionStatus` 固定为 `not-run`；没有做过的验证不会被推断成成功。

## 阶段进度

1. WSL2：第二阶段已实现 Windows 上的只读发行版枚举与用户显式版本探针；不自动 sudo 或安装发行版。
2. SSH Kali VM：第三阶段已实现单台 VMware Kali 的连接配置与显式 SSH 身份/版本检测；密钥/agent 认证和主机密钥核验，不保存密码或私钥内容。
3. Docker：仅选择已存在、正在运行的容器执行探针；不得自动启动、拉取镜像或授予特权。
4. 统一依赖检查及能力评分、环境界面和工具目录扩充。

ARTEX 仍按原先优先级作为**本地工具路径来源**，不是已连接的远程执行环境。环境诊断不触发任何靶标扫描。

## 第二阶段：WSL 发现与显式工具版本检测

Windows 主机在「环境适配 → 执行环境发现」点击「发现本机与 WSL」时，调用异步 `environmentDiscover`，只运行 `wsl.exe --list --verbose`，读取已注册的发行版、运行状态及 WSL 1/2 版本。不会自动安装、启动或进入发行版；非 Windows 主机报告 `unsupported`。

WSL 列表采用 UTF-16LE/UTF-8 兼容读取。列表不支持解析时报告 `unparsed`，不误报“没有发行版”。状态为 `listed` 仅说明发行版已注册；不能当作环境可用。

用户在指定发行版选择内置工具后，点击「显式验证版本」，才会调用 `wslToolProbe`，实际执行：

```text
wsl.exe --distribution <已列出的发行版名> --exec <内置工具名> <固定版本参数>
```

这个操作**可能启动已停止的 WSL 发行版**。只允许内置工具清单中带可信版本参数的工具，不接受浏览器提交任意 shell、命令、文件路径或额外参数。成功仅代表版本命令运行，不代表工具完整能力、依赖就绪或目标任务执行成功。

失败和缺失信息不会覆盖原有 Windows 本机工具解析，也不改旧配置。Docker 与跨环境任务执行仍待后续阶段。


## 第三阶段：VMware Kali SSH 联动

在「环境适配 → VMware Kali · SSH 环境」填写 Kali VM 的 IP/主机名、SSH 用户、端口和可选私钥文件路径（也支持本机 ssh-agent），点击页面的「保存」。配置信息仅保存在原有的 `$DSH_HOME/redteam/config.json` 中，**不保存密码或私钥内容**。这项配置独立于已有的 VPS/FOFA 选项。

- 「发现本机与 WSL」仅会将已配置 Kali 显示为 `configured`，**不会连接 SSH**；不把“已配置”显示成“在线”。
- 「检查 SSH / Kali 身份」才会执行固定的远端命令 `cat /etc/os-release`，区分 Kali 和其他 Linux。不会读取系统凭据。
- 「验证 Kali 工具版本」仅针对内置清单中带可靠版本参数的工具，执行固定的 `<工具名> <版本参数>`。它不是目标扫描，也不证明完整工具能力。
- SSH 使用 `StrictHostKeyChecking=yes`、`BatchMode=yes`、公钥认证、禁用 agent 转发及转发连接；不自动接受陌生主机密钥。首次使用请在 Windows 终端单独连接并人工核对 Kali 的主机指纹。配置错误或 ssh-agent 不可用时会如实显示连接未通过。
- 默认假设 Kali 的 `sshd` 已经由用户自行启用并可由 Windows 主机访问；**不会尝试启动 VMware、修改网络、安装 OpenSSH、启用 root、提权或自动执行目标任务**。

这批改动是单台 Kali VM 的最小实现。多 SSH 主机、Docker 和通用跨环境任务执行留给独立后续版本。
