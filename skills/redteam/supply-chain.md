---
name: supply-chain
description: 软件供应链与 CI/CD 安全审查：代码仓库、构建工作流、Runner、制品库、依赖和供应商访问边界
whenToUse: 授权范围包含 Git 仓库、CI/CD 平台、Runner、制品库、包仓库或供应商交付链路时
role: vuln-scan
category: 验证
tags: [supply-chain, ci, cd, dependencies, provenance]
enabled: true
---

# 软件供应链与 CI/CD 安全审查

供应商、云平台和外包构建系统只有在用户明确列入授权范围时才能测试。默认采用只读配置审查；不要把发现供应商入口等同于获得进入主组织网络的权限。

## 1. 识别组件

- 代码托管：GitHub/GitLab/Bitbucket、自托管 Git 和镜像。
- 构建系统：GitHub Actions、GitLab CI、Jenkins、Runner/Agent。
- 制品与依赖：Nexus、Artifactory、容器镜像仓库、私有包源、缓存代理。
- 身份与信任：PAT、CI Job Token、OIDC、部署身份、机器人账号和供应商 VPN。
- 发布链：分支保护、审批、签名、来源证明、制品晋级和回滚。

## 2. 只读检查清单

- 工作流是否对不可信 PR 执行高权限步骤，是否把不可信输入传入脚本或 shell。
- Token 是否遵循最小权限，是否将写权限默认授予所有工作流。
- Fork PR、标签、分支和环境保护规则是否清晰；发布环境是否需要人工审批。
- Runner 是否隔离、是否复用不可信工作区、是否在任务结束后清理临时工作目录。
- 依赖是否固定版本/摘要，是否使用可信包源，是否存在不受控的缓存和制品覆盖。
- OIDC trust policy 是否限定仓库、分支、环境和 audience；是否避免长期云密钥。
- 制品是否有签名、来源证明、构建日志和可追溯的发布记录。

## 3. 安全验证

- 先用配置和日志确认风险，不读取 Secret 值、不导出 Token、不访问其他项目数据。
- 如需验证权限，使用专用测试仓库、合成 Secret 和无生产权限的测试 Runner。
- 依赖混淆、恶意制品、流水线写入和发布流程测试只能在隔离环境中进行；禁止向生产包源发布同名包或替换真实制品。
- 供应商网络通道只记录配置与责任边界；未获得双方授权时不探测供应商网段或主组织内网。

## 4. 证据与修复建议

- 用 `redteam_scope_review` 确认仓库/域名/Runner 所属范围。
- 用 `redteam_asset_test` 追加工作流文件、权限配置、Runner 标签/隔离方式和日志来源。
- 若在隔离环境创建临时 Runner 工作目录、测试账号或合成制品，用 `redteam_cleanup(op=add)` 分别登记；确认回收后标 `done`，用户要求保留的标 `kept`。不在台账记录 Secret。
- 对可重复的配置缺陷用 `redteam_vuln_add` 记录；证据只保留最小脱敏配置片段，不保存 Secret。
- 修复优先级：最小 Token 权限、隔离 Runner、保护发布环境、固定依赖、验证制品来源、轮换疑似泄露的凭据。

不得读取或使用真实 Secret，不修改生产流水线，不发布恶意制品，不覆盖依赖，不尝试供应商横向访问。
