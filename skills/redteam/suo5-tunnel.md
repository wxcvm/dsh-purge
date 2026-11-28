---
name: suo5-tunnel
description: 验证操作者已独立配置、授权的本机 SOCKS5 隧道，并对单个已登记资产执行受限 TCP 可达性检查
whenToUse: 已有明确授权的测试环境、loopback SOCKS5 监听、登记的 engagement scope 与 tunnel reach
role: internal
enabled: true
---

# 已授权 SOCKS5 隧道验证

本技能只负责**登记、核验和使用一个已经存在的授权隧道**。它不建立远端入口、不上传文件、不绕过认证，也不执行横向移动。

## 使用前提

- 操作者已在授权实验环境中独立配置 SOCKS5 监听；监听必须绑定 `127.0.0.1`、`localhost` 或 `[::1]`，不得暴露到局域网或公网
- engagement 中已登记明确的资产 scope；隧道记录中的 `reach` 也必须覆盖该资产
- 目标必须是已登记、状态为 `live` 的单个 IPv4 资产，端口必须已经被记录为 `open/tcp`
- 隧道入口归属必须如实登记为 target-side；不得为了通过校验而虚报 `entry_kind`

## 验证流程

1. 使用 `redteam_tunnel_add` 登记现有隧道，准确填写监听地址、可达范围和入口归属
2. 使用 `redteam_session_check` 核验隧道当前仍为 active；状态过期或检查失败时停止
3. 使用 `redteam_pivot_probe`，每次只传一个 `tunnel_id`、一个 `asset_id` 和一个已登记开放的 TCP `port`
4. 将结果记录为可达性证据；不要把 TCP 成功解释为登录成功、主机控制权或漏洞成立

## 严格边界

- 只允许单资产、单端口、单次 SOCKS5 CONNECT；不接受 CIDR、目标列表或端口范围
- 只支持 loopback、无认证 SOCKS5；不尝试认证，不读取 banner、应用数据或文件
- 不执行漏洞利用、口令尝试、数据提取或其他后续动作
- 目标不在 engagement scope 或 tunnel reach、资产/端口状态不满足、隧道不 active 时必须停止
- 检查完成后按操作者授权更新隧道状态；只清理本次明确获准清理的资源
