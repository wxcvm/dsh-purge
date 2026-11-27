---
name: l7-service-confirmation
description: TUN/fake-IP 诊断用单主机单端口应用层复核；必须逐次确认
whenToUse: Nmap/httpx 因 TUN/fake-IP 风险被阻断，用户明确要求复核一个授权主机的一个 TCP 端口
role: recon
enabled: true
---

# 单端口应用层复核

仅用于确认某个已授权主机的单个 TCP 端口是否返回可识别应用层响应。它不是扫描器，也不是漏洞验证工具。

## 必须满足

- 当前根会话先完整读取本 Skill。
- engagement 必须登记非空授权范围，host 必须匹配范围。
- 每次调用都要由用户明确确认 host 与 port，并传 confirm=true。
- ports 必须恰好包含一个 1-65535 的 TCP 端口；不使用默认端口表。
- 可选 SOCKS5 代理只允许本机 loopback 地址，例如 127.0.0.1 或 localhost。
- 仅通过 redteam_l7_probe 专用入口；不使用通用 Shell 或自定义探测脚本。

## 结果解释

- REAL_SERVICE：收到可识别的 banner、TLS 或 HTTP 响应，只能证明该端口有相应服务响应。
- FAKE_OR_SILENT：连接后没有可识别的应用层响应；不代表漏洞，也不能证明目标不存在服务。
- UNREACHABLE：本次连接失败；不应自动重试、换端口或扩大目标。
- 不进行登录、认证、漏洞模板、目录枚举、状态变更或后续利用。
