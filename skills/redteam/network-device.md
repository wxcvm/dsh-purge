---
name: network-device
description: 网络与边界设备安全审查：路由器、防火墙、VPN、交换机、堡垒机的只读配置与管理面核查
whenToUse: 授权资产包含网络设备、VPN 网关、防火墙、交换机、路由器或堡垒机时
role: vuln-scan
category: 内网
tags: [network, snmp, vpn, firewall, read-only]
enabled: true
---

# 网络与边界设备审查

网络设备的误操作可能造成大面积中断。本技能默认只读；任何配置变更、固件升级、重启或故障切换都需要单独的书面授权和回滚方案。

## 1. 范围与身份

- 先通过 `redteam_scope_review(allowed=...)` 核对设备 IP、管理域名和网段。
- 优先使用用户提供的只读管理账号、只读 SNMPv3 凭据或厂商导出的脱敏配置。
- 不猜默认口令、不枚举 community string、不复用泄露凭据；没有授权凭据时只整理公开/被动信息。

## 2. 只读盘点

- 记录厂商、型号、固件版本、支持状态、管理接口和资产责任人。
- 检查管理面是否暴露到不必要的网络、是否强制 MFA、是否限制管理源地址、是否使用安全管理协议。
- 在已提供只读访问的前提下，查看设备接口、路由、ACL/NAT、VPN 配置摘要、SNMP 版本和日志转发设置。
- 对配置备份只读取必要片段；遮蔽密钥、预共享密钥、社区字符串、用户和公网地址等敏感值。
- 对固件版本使用厂商公告和 CVE 资料核对，不直接运行利用代码。

## 3. 关系与风险

- 通过 `redteam_asset_query` 获取已有资产；确认 IP 未登记时才用 `redteam_asset_add` 登记，填写真实 IP、`provenance` 和 `tool`。
- 只有存在配置或文档证据时才用 `redteam_asset_link` 记录设备之间的信任、路由或暴露关系。
- 区分管理面暴露、配置弱点、已确认漏洞和单纯版本线索；不要把设备可达等同于跨区突破。

## 4. 证据与交付

用 `redteam_asset_test` 追加型号/版本、管理面范围、只读检查项、证据来源、风险和未检查原因。需要报告漏洞时使用 `redteam_vuln_add`，默认 candidate；确认状态必须有可重复、无副作用的证据。

禁止 SNMP SET、改路由/ACL/NAT、导出完整配置、读取无关第三方凭据、reload/erase/reboot、固件写入和批量管理口尝试。
