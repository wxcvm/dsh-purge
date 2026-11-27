---
name: passive-recon
description: 被动资产情报：只读取公开来源与已保存的子域快照，不访问目标主机
whenToUse: 需要整理证书透明日志、公开 DNS 元数据或被动子域情报时
role: recon
enabled: true
---

# 被动资产情报

本技能只描述通过 redteam_passive_recon 使用的固定被动数据源。它不提供主动扫描、字典枚举或目标访问步骤。

## 外部查询告知

- 向 crt.sh、Subfinder 数据源、Amass 被动数据源或 DNS 解析器提交域名时，域名会暴露给相应第三方/解析器。
- 每次新的外部查询都必须先向用户说明数据接收方与查询对象，取得本次明确同意，并通过 redteam_passive_recon 的 confirm_external=true。
- 不得把先前会话的同意、历史配置或“用户说继续”当作本次外部查询同意。

## 固定能力边界

- subfinder：仅使用适配器固定的被动来源模式；不启用主动枚举、字典、递归或额外 provider。
- Amass：仅使用适配器固定的 enum -passive 模式。
- dnsx：仅对已保存的子域快照执行固定 A/AAAA/CNAME 查询；不接受自定义字典、AXFR、DNS 追踪或任意解析参数。
- 只记录数据源返回的域名和 DNS 观察值，provenance 使用 passive，并记录具体来源与查询时间。
- 被动结果只是线索，不证明资产归属、在线状态、漏洞存在或授权范围。

## 明确不做

- 不运行 naabu、nmap、httpx、katana、ksubdomain、ffuf、feroxbuster 或 nuclei。
- 不访问网页、端口或服务，不提交登录表单，不尝试凭据。
- 不把 DNS 解析出的 IP 自动加入授权 scope；需要主动验证时必须先由用户提供明确范围，并使用独立审查过的适配器。
- 不提供 Shell 命令、任意 argv、代理或隧道配置。
