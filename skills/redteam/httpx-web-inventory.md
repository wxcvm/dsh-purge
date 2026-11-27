---
name: httpx-web-inventory
description: 单目标 HTTP 服务元数据采集上下文；实际任务只能由 redteam_scan_run 专用适配器执行
whenToUse: 用户明确授权的单目标 HTTP 服务状态与基础元数据盘点
role: recon
enabled: true
---

# ProjectDiscovery httpx 单目标 Web 盘点

本技能只为 redteam_scan_run 提供任务上下文，不提供可复制的 CLI 命令，也不是独立执行入口。必须使用 ProjectDiscovery httpx；Python httpx 库不属于此工具。

## 前置条件

- 当前 engagement 必须有用户明确提供的授权范围；目标必须是单个 IP、主机名或 URL，并与已登记范围匹配。
- redteam_scope_review 只做离线匹配，不证明授权。scope 缺失、目标不匹配或授权窗口不明确时停止。
- 不从页面链接、重定向、DNS 结果或标题中自动扩展到其它主机。

## 执行与证据

- 仅使用 redteam_scan_run(kind=httpx)，由适配器选择已验证的 ProjectDiscovery 二进制、固定参数、超时和 JSONL 输出。
- 不进行目录/路径枚举、递归爬取、表单提交、登录、凭据尝试、漏洞模板扫描或状态变更操作。
- 仅把状态码、标题、Web 服务元数据和原始输出作为观察；它们不证明漏洞存在或认证成功。
- 适配器失败、超时或无结果时如实报告；不得使用 Python httpx、通用 Shell 或其它工具绕过适配器。
