---
name: nmap-service-inventory
description: 单目标 Nmap 服务盘点上下文；实际任务只能由 redteam_scan_run 专用适配器执行
whenToUse: 用户明确授权的单目标端口与服务盘点
role: recon
enabled: true
---

# Nmap 单目标服务盘点

本技能只为 redteam_scan_run 提供任务上下文，不提供可复制的 Nmap 命令，也不是独立执行入口。

## 前置条件

- 当前 engagement 必须有用户明确提供的授权范围；目标必须是单个 IP 或主机名，并与已登记范围匹配。
- redteam_scope_review 只做离线匹配，不证明授权。scope 缺失、目标不匹配或授权窗口不明确时停止。
- 目标、端口集合和执行环境必须来自本次用户请求及当前工具选择结果；不得推断或扩大。

## 执行与证据

- 仅使用 redteam_scan_run(kind=nmap)，由适配器选择已验证的二进制、固定参数、超时与输出格式。
- 不得使用通用 Shell、任意脚本、NSE 漏洞/爆破脚本、扫描网段、批量目标、全网段发现或隧道转发。
- 如果适配器返回 tunnel-detected、timeout、tool-missing、failed 或 no-findings，按原状态报告，不得改写为成功。
- 仅将原始输出、哈希、执行清单和已导入的端口/服务作为证据；开放端口不等于漏洞或访问权限。
- 不自动把发现资产加入授权范围；范围外结果必须隔离并报告。
