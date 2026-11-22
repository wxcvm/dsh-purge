# 上游技能吸收审计（2026-11-22）

## 固定来源

- 上游：CallMeGuLab/dsh-purge-safe
- 版本：v2.0.1
- main：d0a9abda6e2eb020dde85b48b5727b45d26582a7
- 许可证：Apache-2.0
- 核验日期：2026-11-22
- 原始许可证和 NOTICE：third_party/CallMeGuLab-dsh-purge-safe/
- 当前已适配文件的逐文件映射：skills/redteam/source-manifest.json

## 技能树差异

| 对比 | 数量 |
|---|---:|
| 上游技能文件 | 40 |
| Purge 技能文件 | 47 |
| 同路径文件 | 28 |
| 仅上游存在 | 12 |
| 仅 Purge 存在 | 19 |

### 同路径文件（均为适配版，不能直接覆盖）

- active-scan.md
- ad-attack.md
- asset-correlation.md
- browser-automation.md
- campaign-planning.md
- chisel-tunnel.md
- cn-proxy-pool.md
- credential-attack.md
- deepseek-web-intel.md
- dir-bruteforce.md
- fofa-recon.md
- frp-tunnel.md
- fscan-intranet.md
- gogo-intranet.md
- kimi-webbridge.md
- lateral-movement.md
- nuclei-scan.md
- passive-recon.md
- recon-pipeline.md
- redteam-setup.md
- score-coverage.md
- shell-handler.md
- specialist-paths.md
- suo5-tunnel.md
- unauth-exploit.md
- vps-reverse-shell.md
- web-fingerprint.md
- webshell-toolkit.md

### 上游独有（待逐项吸收或合并）

- ai-agent-attack.md
- api-data-exfil.md
- asset-deep-scan.md
- c2-infra.md
- cloud-k8s.md
- host-post-exploit.md
- mobile-code-recon.md
- netspy-recon.md
- network-device.md
- oob-verify.md
- opsec-hygiene.md
- supply-chain.md

### Purge 独有（保留）

- api-attack.md
- armory-index.md
- auth-attack.md
- business-security-controls.md
- cloud-container.md
- credential-to-access.md
- deserialize.md
- evidence-discipline.md
- exploitdb-lookup.md
- file-upload.md
- payload-c2.md
- privesc.md
- read-to-rce.md
- safe-exploit.md
- score-mapping.md
- ssrf-xxe.md
- web-injection.md
- web-midware.md
- xss-csrf.md

## 已确认的吸收原则

1. 不按文件名相同就覆盖；同路径的 28 个文件都存在正文差异，Purge 版本包含本项目工具接口、证据流程和 VPS 环境适配。
2. asset-correlation.md 是明确内容缺口：当前 Purge 版本明显短于上游，应补齐资产分层、关联和证据闭环。
3. 上游独有技能中，AI Agent 攻击面、API 数据暴露、资产深度扫描、C2 基础设施、移动端代码侦察、网络设备、带工具前置检查的 NetSpy、OOB 验证、OPSEC、供应链和主机后渗透有独立价值；Cloud/Kubernetes 与现有 cloud-container 需要合并，避免重复。
4. 不全局替换 redteam_chain_add。按记录对象使用专用 redteam_score_hit、redteam_vuln_add、redteam_tunnel_add；只有真实攻击路径事件才保留 chain_add。
5. recon-pipeline 保留 Purge 的 FOFA 非默认策略；Purge 独有技能继续保留。
6. 需要外部二进制的技能必须明确前置检查，不得把未安装工具描述成可直接使用。

## 下一步

- 补齐 asset-correlation。
- 逐项新增或合并上游独有技能，并更新 source manifest。
- 为技能分类、来源版本和许可证保留可检索元数据。
- 继续跑技能目录、知识库、宿主列表与打包测试；真实 Windows Harness GUI 验收单独记录。
