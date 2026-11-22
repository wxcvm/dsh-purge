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
| Purge 技能文件 | 54 |
| 同路径文件 | 35 |
| 仅上游存在 | 5 |
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

### 原始上游独有路径（第一批吸收后仍有 5 个）

- api-data-exfil.md → 已合并适配到本地 api-attack.md
- cloud-k8s.md → 已合并适配到本地 cloud-container.md
- c2-infra.md → 暂缓：不移植长期控制、载荷投递和规避检测流程
- host-post-exploit.md → 暂缓：现有 privesc/lateral-movement 已覆盖部分内容，需先做更细语义去重与凭据边界设计
- netspy-recon.md → 暂缓：上游依赖外部 netspy 二进制，当前没有可验证的本地工具/安装交付，不将其描述成已安装能力

### 第一批新增独立技能（7）

- ai-agent-attack.md
- asset-deep-scan.md
- mobile-code-recon.md
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

- 对第一批新增/合并的 9 个映射继续做宿主加载、技能面板和真实使用反馈验收。
- 继续复核剩余 3 项：c2-infra、host-post-exploit、netspy-recon；只有存在安全、工具和授权边界闭环时才吸收。
- 后续社区来源按源码证据、许可证、真实工具映射和必要回归逐批吸收；不按数量追求复制率。

## 第一批内容吸收（2026-11-22）

来源固定为上游 `CallMeGuLab/dsh-purge-safe@d0a9abda6e2eb020dde85b48b5727b45d26582a7`（v2.0.1，Apache-2.0）。本批完成：

- 扩充 `asset-correlation.md`：加入范围复核、T0–T3 归属证据分级、共享 CDN/证书/ASN 的误归属防护、真实 ID 关系边和证据记录。
- 新增 7 个独立技能：AI/Agent、单资产深度评估、移动端代码侦察、网络设备、OOB 无害回调、OPSEC/收口、供应链 CI/CD。
- 将 `api-data-exfil.md` 的有价值部分改写为合成账号/最小数据暴露验证并并入 `api-attack.md`。
- 将 `cloud-k8s.md` 的只读云身份、RBAC、容器和镜像审查并入 `cloud-container.md`。
- 更新 source manifest 至 37 个逐文件映射；新增映射均保存固定上游路径和 blob SHA。

安全适配决策：

- 不导入上游的批量数据导出、凭据明文收集、默认口令猜测、限速绕过、隐蔽 C2、载荷投递、主机横向扩展和容器逃逸步骤。
- 新技能只引用当前 Purge 已注册的工具接口；测试仅在明确授权范围、测试账号、合成数据和可回滚环境内进行。
- `redteam_data_proof`、`redteam_cleanup`、`redteam_pivot_probe` 等上游独有接口未被伪装成 Purge 现有工具。
- `c2-infra`、`host-post-exploit` 和 `netspy-recon` 保留为明确暂缓项，不宣称已吸收。

验证范围：技能目录/来源元数据/工具引用契约测试；npm 包含技能目录的既有打包契约；真实 Windows Harness GUI 和 Provider 行为不由这些静态测试替代。
