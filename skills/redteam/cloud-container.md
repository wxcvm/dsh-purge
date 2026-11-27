---
name: cloud-container
description: 云平台、Kubernetes 与容器安全审查：身份权限、Metadata 配置、集群暴露面、镜像和运行时隔离
whenToUse: 授权资产运行在 AWS/Azure/GCP/阿里云/腾讯云，或包含 Kubernetes、容器、镜像仓库和 CI Runner 时
role: vuln-scan
category: 云与容器
tags: [cloud, kubernetes, container, iam, metadata]
enabled: true
---

# 云平台、Kubernetes 与容器安全审查

默认只读。云账号、供应商和 Kubernetes 集群必须明确列入授权范围；不要因为本机或容器能访问 Metadata 地址就读取凭据。

## 1. 身份与云控制面

- 使用用户提供的只读身份，先确认当前账号、订阅、项目、角色和组织边界。
- 可使用厂商身份查询命令查看当前身份元数据；不得读取或输出 Access Key、Secret、Token 或服务账号私钥。
- 检查 IAM 最小权限、长期密钥、跨账号信任、MFA、审计日志和高权限角色绑定。
- Metadata 服务只审查版本、访问控制和部署配置；不要请求返回临时凭据的 endpoint。

## 2. Kubernetes

- 先确认集群、命名空间和授权范围，再查看 API Server 版本、节点/工作负载清单和 RBAC 摘要。
- 使用只读权限核对 `kubectl auth can-i --list`、ServiceAccount 绑定、Role/ClusterRole、NetworkPolicy 和 Pod Security 设置。
- 检查匿名访问、过度宽泛的 ClusterRole、默认 ServiceAccount、hostPath、privileged、hostNetwork、hostPID 和 Docker socket 挂载配置。
- 不读取 Secret 内容，不导出 kubeconfig/token，不尝试容器逃逸，不创建 Pod、不执行命令、不修改 RBAC。

## 3. 容器与镜像

- 只读检查镜像来源、标签是否固定、摘要、签名、基础镜像维护状态、软件清单和漏洞扫描结果。
- 检查容器是否以 root 运行、是否启用只读根文件系统、是否移除不必要 capabilities、是否限制 CPU/内存和网络。
- Docker socket、宿主目录挂载和 privileged 配置只记录为风险；不挂载宿主根目录、不执行逃逸验证。
- 对 CI Runner 检查工作区隔离、凭据注入和任务结束后的清理策略。

## 4. 对象存储与数据

- 检查 Bucket/Container 的公开访问策略、加密、日志、版本控制和最小权限配置。
- 不下载对象内容、不遍历数据目录、不读取个人信息；使用策略与元数据证明访问范围。
- 发现可能暴露的数据时只记录对象数量/类型和脱敏元数据，交由数据责任人确认。

## 5. 证据与交付

- 用 `redteam_scope_review` 核对云账号、集群和域名范围。
- 用 `redteam_asset_test` 追加云厂商、项目/订阅、集群版本、RBAC、镜像和存储策略检查结果。
- 资产 IP 确认且尚未登记时，才使用 `redteam_asset_add`；该工具要求真实 IPv4。
- 对可复现的配置缺陷使用 `redteam_vuln_add`，证据中不得包含凭据或真实数据。

禁止读取 Metadata 凭据、导出 Secret、容器逃逸、修改 IAM/网络/集群资源、删除实例或停止工作负载。
