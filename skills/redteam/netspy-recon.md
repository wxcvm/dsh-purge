---
name: netspy-recon
description: 可选 NetSpy 内网可达网段发现：仅在用户提供并验证外部二进制、且授权明确列出候选 CIDR 时使用
whenToUse: 已授权的自有/实验内网需要从指定主机确认有限候选网段的可达性，且用户已准备可信 NetSpy 二进制时
role: recon
category: 内网
tags: [internal, segment, reachability, optional-tool]
enabled: true
---

# NetSpy 内网可达网段发现（可选依赖）

NetSpy 不是 Purge 内置工具，也不随插件或工具箱安装包分发。缺少二进制时，本技能应保持 blocked/未执行；不要从不明镜像下载，也不要把它描述成已经安装。

## 1. 二进制前置检查

- 预期路径：`$DSH_HOME/redteam/toolkit/netspy/netspy`（Linux）。
- 先检查文件存在、可执行并能返回版本；只接受用户自行从可信官方发行渠道取得、并核验发布方校验值的二进制。
- 当前 setup 脚本不会下载 NetSpy；不要把运行通用 setup 脚本说成能安装它。
- 缺少可信二进制时停止，记录 optional dependency missing，改用已安装且获准的资产清单/路由信息，不要自动安装。

## 2. 先确定允许范围

- 只从用户控制且明确授权的内网主机执行；NetSpy 使用本机网络栈/原始套接字，不是 SOCKS 客户端。
- 先读取 `ip -br addr` 和 `ip route`，仅将用户明确批准的 CIDR 作为候选。
- 不扫描默认 RFC1918 全空间、不从路由表自动扩大授权、不探测第三方/共享网段。
- 优先单个小网段、低并发、短时间窗；UDP 探测必须另有明确授权。

## 3. 低噪声运行原则

在目标侧且授权明确后，先运行版本检查，再仅对用户明确批准的一个 CIDR 执行 ICMP 探测：

```bash
NETSPY="$DSH_HOME/redteam/toolkit/netspy/netspy"
"$NETSPY" version
mkdir -p runs
"$NETSPY" -c "<已批准 CIDR>" -t 20 -m 150 -r 1 -s \\
  -o "runs/netspy-<资产ID>-<时间>.txt" is
```

`is` 是 ICMP 子命令；默认不执行 TCP/UDP 探测。若需要其他协议，先单独确认授权方式和明确端口，再记录参数与结果。不得自行扩大 CIDR 或切换探测协议。

- 每次只指定明确的 `-c CIDR`，输出文件使用唯一名称；记录源主机、网卡、时间和参数。
- 从低并发开始（例如 `-t 20`），保留随机抽样和超时设置；不得使用 `-f 255` 全量强制探测或 `-i` 特殊内网模式。
- 出现业务异常、告警、目标封禁、范围不确定或用户撤回授权时立即停止。
- 不通过代理链在本地伪装成目标侧探测；只有用户授权的目标侧主机才可运行。

## 4. 结果解释与资产记录

- NetSpy 结果只证明在本次时间窗和探测方式下观察到可达/响应，不证明资产归属、登录权限、漏洞或边界突破。
- 只有结果明确包含具体 IPv4 主机时，才对授权范围内的地址使用 `redteam_asset_add` 登记，填写真实 IP、`provenance=active`、`tool=netspy` 和 `state=live`。若输出只有 `/24` 等网段 CIDR，只把它作为网段线索保留在报告/结果文件中；不要把网络地址伪造成单主机资产。
- 对已存在且对应具体 IP 的资产，用 `redteam_asset_test` 追加“NetSpy 发现可达，尚未做服务/漏洞验证”，状态保持 untested；不得因此记入权限或边界得分。
- 结果文件只保存必要摘要，不记录凭据、用户数据或无关第三方地址。

禁止默认全网段探测、暴力枚举端口、弱口令测试、漏洞利用、横向移动、隧道建立或持久化。
