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
| Purge 技能文件 | 56 |
| 同路径文件 | 37 |
| 仅上游存在 | 3 |
| 仅 Purge 存在 | 19 |

### 同路径文件（35 个，均为适配版，不能直接覆盖）

- active-scan.md
- ad-attack.md
- ai-agent-attack.md
- asset-correlation.md
- asset-deep-scan.md
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
- host-post-exploit.md
- kimi-webbridge.md
- lateral-movement.md
- mobile-code-recon.md
- network-device.md
- netspy-recon.md
- nuclei-scan.md
- oob-verify.md
- opsec-hygiene.md
- passive-recon.md
- recon-pipeline.md
- redteam-setup.md
- score-coverage.md
- shell-handler.md
- specialist-paths.md
- supply-chain.md
- suo5-tunnel.md
- unauth-exploit.md
- vps-reverse-shell.md
- web-fingerprint.md
- webshell-toolkit.md

### 原始路径差异（3 个；2 个已合并适配，1 个暂缓）

- api-data-exfil.md → 已合并适配到本地 api-attack.md
- cloud-k8s.md → 已合并适配到本地 cloud-container.md
- c2-infra.md → 暂缓：不移植长期控制、载荷投递和规避检测流程

### 第一批新增独立技能（7）

- ai-agent-attack.md
- asset-deep-scan.md
- mobile-code-recon.md
- network-device.md
- oob-verify.md
- opsec-hygiene.md
- supply-chain.md

### Purge 本地文件名独有（19 个；其中 2 个已合并上游内容）

- api-attack.md（已映射上游 api-data-exfil.md）
- armory-index.md
- auth-attack.md
- business-security-controls.md
- cloud-container.md（已映射上游 cloud-k8s.md）
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

1. 不按文件名相同就覆盖；当前 35 个同路径技能均保留 Purge 工具接口、证据流程和本地化适配。
2. `asset-correlation.md` 已补齐授权范围核对、归属证据分级、共享基础设施排除和真实资产关系 ID。
3. 第一批新增 AI Agent、单资产深挖、移动端、网络设备、OOB、OPSEC、供应链 7 个技能；API 数据暴露和 Cloud/Kubernetes 分别合并进既有 `api-attack.md` 与 `cloud-container.md`。
4. 不全局替换 `redteam_chain_add`。按记录对象使用 Purge 已注册的专用工具；上游独有接口不伪装成当前能力。
5. `recon-pipeline` 保留 Purge 的 FOFA 非默认策略；Purge 独有技能继续保留。
6. 需要外部二进制的技能必须明确前置检查，不得把未安装工具描述成可直接使用。
7. 后续只吸收能证明有独立价值、能映射现有接口且具备授权/安全边界的内容；不以复制数量作为完成指标。
## 下一步

- 对两批新增/合并的 11 个映射继续做宿主加载、技能面板和真实使用反馈验收。
- 仅剩 c2-infra 暂缓：不移植长期控制、载荷投递和规避检测流程。
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
- `c2-infra` 保留为明确暂缓项；`host-post-exploit` 与 `netspy-recon` 在第二批中以安全边界明确的适配版吸收。

验证范围：技能目录/来源元数据/工具引用契约测试；npm 包含技能目录的既有打包契约；真实 Windows Harness GUI 和 Provider 行为不由这些静态测试替代。


## 第二批内容吸收（2026-11-22）

- 新增 `host-post-exploit.md`：只读 Linux/Windows 主机基线、服务/权限/补丁和配置风险审查；不读取凭据、不转储秘密、不提权、不横向。
- 新增 `netspy-recon.md`：保留 NetSpy 可达网段发现价值，但标为可选外部依赖；必须由用户提供并验证可信二进制，只能针对显式授权 CIDR 低噪声执行。
- source manifest 增至 39 项，新增两个来源映射均固定到上游 revision/blob SHA。
- `skill-fixes.js` 为 NetSpy 提供专门的可选依赖说明，缺少二进制不会误导用户运行 setup 脚本下载不存在的工具。
- 目前唯一暂缓的上游独有技能为 `c2-infra.md`：长期控制、载荷投递和规避检测流程不直接移植；Purge 已有的合法隧道技能继续独立维护。
