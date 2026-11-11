# 多环境与工具能力适配：第一阶段

此阶段仅增加环境与工具能力的**只读事实层**，不替换现有作战工作流，不增加工具，不要求用户重新配置。

## 已实现

- `environmentList`：列出当前 Node 进程所在本机。不能据此推断已连接 WSL、Kali VM 或 Docker。
- `environmentDiagnose`：只读定位内置 23 个工具的路径，返回每个工具的来源、状态与诊断建议。**不执行版本命令，也不对目标发送请求**。
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
3. Docker：第四阶段已实现当前 Docker context 中运行容器的只读清单，以及用户明确选择容器和内置工具后的版本探针；不会创建/启动容器、拉镜像、授予特权或扫描目标。
4. 第五阶段：统一能力矩阵已接入环境页面；依赖真实性验证、跨环境自动选用与真实任务执行仍待后续阶段。

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

## 第四阶段：Docker 运行容器发现与显式版本探针

- 在「管理 → 环境适配」点击「发现本机、WSL 与 Docker」时，调用本机 `docker ps --no-trunc --filter status=running --format '{{json .}}'`。只列出当前 **Docker CLI context** 中已经运行的容器（context 也可能连接远端 daemon），不启动 Docker daemon、容器，也不创建/拉取镜像。
- 找不到 Docker CLI、daemon 不可达和清单解析失败都明确显示状态，不会当作「没有容器」。
- 从实际发现的容器列表中选择容器和内置工具，点击「显式验证版本」，会重新确认该容器仍在运行，随后执行 `docker exec <列出的容器 ID> <内置工具命令> <固定版本参数>`。不能把 UI 输入当作任意容器、命令或参数使用。
- 版本命令成功只证明容器内相应程序运行了版本探针，不等于完整依赖验证或任何目标扫描；保留 `dependencyStatus: not-checked`、`capabilityVerified: false` 与 `executionStatus: not-run`。
- Docker 发现/探针与 Windows 本机、WSL、VMware Kali SSH 的配置彼此独立；不改已有工具路径优先级。

## 待完成的跨环境阶段

统一依赖检查、按任务类型的跨环境能力评分、统一真实执行记录及其来源归属仍需后续实测。需要把版本可运行与任务可执行/已执行区分开，而不是把本机/WSL/SSH/Docker 的工具路径简单合并。真正 Windows Harness、WSL、Kali 与 Docker 实机验收也不由 CI 模拟测试替代。

## 工具目录增强：新增六项可选工具

现在内置 23 项工具名称及版本探针，原有 17 项保持现有路径解析优先级；新增项不安装程序、不触发扫描、不代替用户设置。

| 工具 | CLI 检测参数 | 对应任务 | 版本验证不代表的依赖 |
| --- | --- | --- | --- |
| Feroxbuster | `--version` | Web 资产 | 目标可达、字典可用 |
| testssl.sh | `--version` | TLS/漏洞准备 | Bash、OpenSSL 及基础 Unix 工具可正常执行实际 TLS 测试 |
| smbclient | `--version` | 内网与身份 | Samba 协议、目标可达、身份凭据 |
| Gowitness | `version` | Web 截图 | Chrome/Chromium 等运行依赖 |
| NetExec（nxc） | `--version` | 内网与身份 | Python/协议插件、认证及目标服务 |
| OWASP Amass | `-version` | 域名收集 | DNS、外部数据源、API Key |

- 所有版本探针均通过当前实现的本机/WSL/Kali SSH/Docker 工具目录执行，依赖条件以独立说明显示为「未检查」而非「已验证」。Gowitness 使用固定的 `version` 子命令，不接受浏览器传入任意子命令。
- `testssl.sh` 是 Bash 脚本。Windows 原生 Node 没有 Bash 执行环境时，可能只找到路径而无法直接运行版本检测；可以使用已有 WSL/Kali/Docker 环境，**不要误报原生已验证**。
- 工具任务画像只是候选推荐，不会自动选择执行环境或运行扫描。

## 配置 v2 与按任务工具偏好

在现有 `$DSH_HOME/redteam/config.json` 上增加可选的 `planning.preferredToolByTask`，例如：

```json
{
  "version": 2,
  "planning": {
    "preferredToolByTask": {
      "services": "nmap",
      "web": "gowitness"
    }
  }
}
```

这只是局部配置结构示例，实际配置仍保留原有 `platform`、`tools`、`binDirs`、`env`、`kaliVm` 和其他字段，不要用示例覆盖完整文件。读取旧版 `version:1` 不会立刻写盘；下次用户点击「保存」时才生成 v2 文件，且保留原字段。旧版本回退时仍能读取工具路径等字段。任务工具偏好仅影响推荐排序，**不会授权或执行程序**。

「管理 → 环境适配 → 按任务选择工具」现在可以为每类任务选一个首选工具（或者「自动推荐」），保存后再次匹配。候选仅按真实本机路径、版本探针可用性、已保存偏好及既有路径来源优先级评分。UI 会显示推荐原因和分数；没有运行过版本探针时仍返回 `verification: not-run`。不存在的首选工具不会排挤已找到的其他工具。远端 WSL/Kali/Docker 在此阶段不会被推断成自动执行环境，也不会发生自动切换。

## ARTEX 本机能力来源（不属于远端执行环境）

在「环境适配 → 发现本机、WSL 与 Docker」的结果里新增 `providers.artex`，固定来源标识 `artex:local`。它只根据当前 ARTEX 工具目录位置查找 ARTEX Tool Manager 已安装的七项本机工具，返回路径、发现时间和来源状态；不会探测 ARTEX HTTP 健康接口，也不会读取 ARTEX 账号/Token/配置/数据库。

`artex:local` 的 `kind=binary-source`、`executionEnvironmentId=local`；不列为第 5 个可执行环境。发现一个文件只返回 `located`，`online=null`、`capabilityVerified=false`、`executionStatus=not-run`，独立于 ARTEX 服务在线与否。既有本机工具查找仍以显式路径、工具箱、binDirs 和 PATH 为优先，ARTEX 依然是最后的本地回退来源。

## 已有本机扫描执行记录的环境来源

`redteam_scan_run` 通过现有的本机 `runDiscoveryScan` 执行 Nmap/httpx 时，已有的扫描 manifest 现在会额外记录 `execution`：

`executionId` 为同一运行 ID，`environmentId=local`，`toolId` 为 Nmap/httpx，`binarySource` 为工具文件实际来源（包括 ARTEX 回退时的 `artex`）。记录是否真正向进程执行器发起调用及进程原始结果（完成、失败、超时、空输出），与之后是否成功解析/导入是两件不同的事。

「作战 → 扫描记录」展开详情，以及 `redteam_scan_history` 返回的数据，都会直接沿用这份真实 manifest；不另外建日志数据库、不伪造旧记录。旧 manifest 没有 `execution` 时显示来源未知。该字段不会因读取工具清单、环境发现或运行版本探针而写入。

当前这只覆盖真正通过 **本机** Nmap/httpx 执行器运行的任务；WSL、SSH Kali、Docker 仍只接入了发现和显式版本命令。不能把远端工具版本检测统计成已经做过目标扫描。


## 第五阶段：跨环境工具能力矩阵

「管理 → 环境适配 → 跨环境工具能力矩阵」点击 **生成 / 刷新能力矩阵** 时，调用 `environmentCapabilityMatrix`。它复用现有 `environmentDiscover` 和 `inventoryLocalCapabilities`，生成全部 **23 种内置工具 × 当前已发现执行环境** 的只读表。

- **本机：** 使用现有配置、工具箱、PATH、ARTEX 回退定位文件，分别显示「已定位」或「未定位」。找到路径并不等于可运行。
- **WSL、SSH Kali、Docker：** 发现发行版、已配置 VM 或运行容器，并不代表对应工具已安装；所有远端工具默认显示「未检查」，不会被错误判定为「未安装」或「可用」。
- **ARTEX：** 仍只是 `artex:local` 工具路径来源，在本机表格单元格标注，不被算作独立执行环境。
- **手动版本验证：** 使用页面已有的本机 / WSL / Kali / Docker 版本检测按钮；检测成功后相应表格项显示「版本已验证」，失败显示「验证未通过」。同一会话内 Kali 的不同工具结果可以分别显示。
- **结果生命周期：** 手动验证结果仅作为当前面板会话的临时 UI 状态；重新发现环境、重新生成矩阵或保存配置后会清除可能过期的结果。**不会假装拥有跨重启的最新探针记录**。
- **依赖与任务：** 矩阵始终把 `dependencyStatus` 标为 `not-checked`，`capabilityVerified` 标为 `false`，`executionStatus` 标为 `not-run`。已运行扫描仅依据既有扫描 manifest 的真实执行记录判断，不把版本命令算成扫描。
- **目标行为：** 读取矩阵会执行已实现的只读 WSL/Docker 环境列举（Docker context 可能指向预先配置的远程 daemon），但不启动容器、虚拟机或版本探针，不安装工具、不运行网络目标测试。

API 返回 `environments`、`providers`、`rows`（每个工具的 `cells`）和 `summary`；原有 `platformTaskPlan`、`environmentDiscover`、`wslToolProbe`、`kaliVmToolProbe`、`dockerToolProbe` 不变。这一步没有配置文件迁移，也没有新的强制门禁。

真正的依赖验证（例如 Bash/OpenSSL、浏览器、Samba 协议环境）和跨环境任务执行需要单独的实现与实机验收，不应由矩阵推断。
