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

- `action=subdomains` 默认只读取已经保存的 CT 快照；不会在本工具中实时查询 crt.sh。
- 选择 subfinder 或 Amass 时，根域名会提交给该工具当前配置的被动数据源；选择 dnsx 时，已保存主机名会提交给本机系统 DNS 解析器。
- 每次新的外部查询都必须先向用户说明查询对象、数据接收方和网络路径限制，取得本次明确同意，并通过 `redteam_passive_recon` 的 `confirm_external=true`。
- 不得把先前会话的同意、历史配置或“用户说继续”当作本次外部查询同意。

## 固定能力边界

- 所有动作都要求项目登记精确 `*.根域名` 范围；根域名本身和其它后缀不自动纳入。
- subfinder：仅使用适配器固定的被动来源模式；不启用主动枚举、字典、递归、`-all` 或自定义 argv。可在明确选择的 local、WSL、Docker 或已验证 SSH Kali 环境运行。
- Amass：仅使用适配器固定的 `enum -passive` 模式；当前仅支持 local，输出写入私有临时目录并在导入后清理。
- dnsx：只解析最新已保存子域快照中的主机名，最多 200 项；固定 A/AAAA/CNAME 查询，使用本机系统 DNS 解析器，不走 HTTP/SOCKS 代理；当前仅支持 local。
- dnsx 在检测到 TUN/fake-IP 时拒绝启动；没有检测到 TUN 不代表 DNS 出口经过代理或 VPS，网络路由状态始终标记为未验证。不得将系统代理等同于 DNS 代理。
- `action=history` 离线读取根域的子域快照；`action=dns-history` 离线读取授权范围内单个主机的 DNS 快照，不联网、不需要外部查询确认。
- `commit` 默认 false；只有显式 `commit=true` 才保存子域或 DNS 快照。
- 只记录数据源返回的域名和 DNS 观察值，保留具体来源、执行环境、状态、时间与输出哈希。
- 被动结果只是线索，不证明资产归属、在线状态、漏洞存在或授权范围；DNS 解析出的 IP 不自动加入资产或授权范围。

## 明确不做

- 不运行 naabu、nmap、httpx、katana、ksubdomain、ffuf、feroxbuster 或 nuclei。
- 不访问网页、端口或服务，不提交登录表单，不尝试凭据。
- 不把 DNS 解析出的 IP 自动加入授权 scope；需要主动验证时必须先由用户提供明确范围，并使用独立审查过的适配器。
- 不提供 Shell 命令、任意 argv、代理或隧道配置。
