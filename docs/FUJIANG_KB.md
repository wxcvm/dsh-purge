# 富江破甲离线 CVE 候选索引

来源：[FJNB5/fujiang-pojia](https://github.com/FJNB5/fujiang-pojia) 的 `plugin/knowledge/` 目录，
固定参考提交 [cf086fc](https://github.com/FJNB5/fujiang-pojia/commit/cf086fc329011c6f8eeb3b67f0adbcc3f005debb)。

## 本轮吸收的内容

- **105 条组件/CVE 与配置风险元数据**，覆盖 Java 反序列化、Java Web、云与容器、边界设备、Exchange / AD、Linux 提权及 Web / CMS。
- 仅保留分类、标题、CVE、产品、受影响版本声明、端口、关键词和每条原始资料链接。**未复制上游的 PoC 正文或利用步骤**。
- 数据以 JSON 放在 `lib/redteam/cve-catalog/`，随当前插件包发布，默认纯离线检索。
- `redteam_cve_match` 可直接从现有 SQLite 的 `asset_id` 读取服务/产品/banner/指纹，也可不依赖数据库按 `cve` 或 `product` 查询。不创建第二套任务台账，不自动导入现有漏洞库。
- 匹配返回 `matched_score` 和 `matched_reasons`，结果一律 `status: candidate`、`verified: false`。通用端口不能单独推断漏洞，受影响版本由人工复核或后续证据验证。
- 结构化版本范围由 CVE 目录中的 `version_constraints` 和对应厂商公告维护，按各自分支及修复边界判断候选适用性。版本命中只表示候选适用性，不代表目标已验证。
- 指纹匹配只从端口上记录的服务/产品/banner/页面标题，以及 SQLite `fingerprint.evidence` 等实际指纹证据中取信号；**主机名和 URL 自身不会推断组件安装**。需要手工检索时仍可直接输入 `product` / `keyword`。
- 已有 `redteam_poc_search`（本机 PoC/模板）与 `redteam_vuln_add` / `redteam_http_evidence_add`（真实验证记录）继续原样工作。
- 上传包中的 59 条业务安全资料已归纳为 `skills/redteam/business-security-controls.md` 防御性控制基线，覆盖对象级授权、多租户隔离、字段白名单、订单状态机、支付回调、幂等与并发、令牌生命周期、隐私导出、SSRF 与 WebSocket 边界；未复制上游 PoC 或利用链。

## 为什么不直接安装富江破甲到当前 profile

它会安装 `@deepseek-ai/dsh-prompt-custom`、单独管理提示词文件与 UI。直接并装容易造成提示词、服务及 UI 入口重复。我们吸收检测数据和索引思路，复用自己已经有的存储、工具、权限与回退路径。

## 来源与许可

原仓库的 `plugin/package.json` 声明 MIT；其 `plugin/LICENSE` 写有：

```
MIT License
Copyright (c) 2026 DSH Desktop contributors
```

CVE 索引只提取必要元数据并保留每条原始链接；业务安全资料则归纳为防御性控制清单，不复制原始 PoC 或利用步骤。尊重上游署名及源码许可。上游条目中的 `verified: false` 没有变成实测结论。对外使用时按具体厂商安全公告与 NVD 再核对版本。

## 当前集成状态

AboutSecurity 的安装、更新、界面技能浏览和可选 DSH 原生 Provider 已在现有「管理 → 技能库」中实现，详见 [独立集成说明](ABOUTSECURITY_INTEGRATION.md)。内置技能 frontmatter 描述已参与目录展示与检索；任务上下文可根据实际任务表面、开放服务和指纹证据推荐产品技能及业务安全控制技能，不再要求先命中 CVE。`redteam_next_action` 还可把明确独立的只读记录核查任务组成并行批次，遵循当前用户配置的并发上限（默认 3）；主动探测和有依赖的任务仍按阶段顺序执行。自动作业链继续复用原来的任务、证据和进度对账系统，没有增加第二套 `campaigns.json`。Desktop 实机调用与新版本发布需单独验收。

## 完整防御性参考库（v0.20.13 上传归档）

- 以实际上传归档的 176 个 Markdown 文件为基准：105 个组件/CVE 条目、59 个业务安全条目、3 个方法论、9 个分类入口。逐条归纳防护和修复，保留原文件路径，所有原始条目为未验证；不复制 PoC、利用步骤或攻击性操作链。
- `lib/redteam/fujiang-reference-data.json` 存放独立防御性摘要，`fujiang-reference.js` 复用现有 CVE 目录中的产品、版本、来源和公告信息，生成稳定 ID `fujiang:<分类>:<原文件名>`。分类入口按实际文件清单生成（原归档的 gray-market 分类描述仍写 29 条，但实际有 59 条）。
- 参考资料接入已有 bundled 知识搜索和详情，按标题、标签、正文检索，列表只返回摘要，按需读取正文；与 105 条 CVE 候选索引分工，不自动建立漏洞、改动个人知识数据库或引入新依赖。
- `CVE-2019-9193` 依据 PostgreSQL 厂商声明标记为 vendor-disputed（预期权限功能），保留原历史版本及等级；`CVE-2024-53677` 依据 Apache S2-067 修正版本与迁移条件。其他未经独立核对的修复摘要标明原包资料及厂商复核待办，不能视为最新已验证修复。
- 105 条组件/配置知识现已按相应厂商公告或官方配置指南完成资料级复核，并保留原始说法与修正说明；这不等于任何目标资产已经受漏洞影响或实际完成验证。上游文件引用保留原固定提交，上传包来源路径亦独立保留。

## 全量原始资料归纳（167 篇正文）

- 依据上传的富江 v0.20.13 压缩包重新核对全部 167 篇正文的 frontmatter、修复章节和参考章节。原包中的 UTF-8 BOM 与 CRLF 在解析前统一处理；此前误判为缺失 frontmatter 的条目现在使用原始字段。
- `lib/redteam/fujiang-source-archive/` 保存 167 条原始资料记录：105 个组件/配置条目、59 个业务安全条目和 3 个方法论条目；九个分类入口仍独立计数。每条保留原始标题、产品、标识、严重度、CVSS、版本、端口、关键词、来源及未验证状态，原始修复意见与现行防御归纳分开呈现。
- 读取副本来自固定的 `sanjiu2024/dsh-team-workflow@c55070e2858c1677bbebaf6ec1e8f13dad366cd6`，按批次与原始上传 ZIP 中的元数据及防御章节比对。原归档路径和已有 CVE 索引 URL 不变，详情另显示固定读取副本。
- Java Web 22 个条目的防御性摘要和公告来源同步复核更新，包括 Druid 的认证前提、Confluence 的分支修复边界、GitLab 的遗漏受影响版本、ActiveMQ Classic / Artemis 的区别，以及 Struts S2-067 的上传机制迁移要求。
- 原始资料字段和历史修复建议保留不代表目标已验证。没有复制 PoC、攻击入口、利用步骤或操作链；识别和前置条件章节登记为来源线索，现行建议依据厂商公告或官方指南纠正。知识复核与具体资产的补丁状态仍是不同结论，不把历史 CVSS 当作当前目标风险。

- 同一批次进一步补齐 Solr、TeamCity 两条、OFBiz、Confluence 22515、GitLab 7028 六组结构化版本判断；修复版本按分支单独处理。ActiveMQ Classic 与 Artemis 不使用跨产品混合版本区间；NVD 与 CNA 评分差异保留原来源。


## 知识使用与验收（不需要先创建个人知识库）

1. `redteam_knowledge_search(query="CVE-2021-43798", source="bundled")`：获取富江离线参考条目摘要、稳定 ID、原始资料 `source_url` 及独立核对公告 `advisory_url`。
2. `redteam_knowledge_get(source="bundled", id="fujiang:cloud-container:cve-2021-43798-grafana-file-read")`：查看完整修复摘要及原始资料来源，不将搜索结果视为目标验证。
3. `redteam_cve_match(asset_id=<已有资产ID>)`：按数据库中已有开放端口、软件指纹和版本进行候选匹配；也可按 `cve` / `product` 手动查询。
4. `redteam_task_context(target="asset #<ID>")` 或 `redteam_task_context(target="vuln #<ID>")`：根据已有记录返回知识引用，再将对应 `reference.source` 和 `reference.id` 传给 `redteam_knowledge_get`。任务卡不直接返回整篇正文。
5. 核对 Windows 与 Linux CI 的代码测试结果，再单独在实际 Harness 的当前插件版本上调用上述工具；CI 成功不代表桌面运行时已经加载新版本。

**版本判断边界：** 仅在产品版本及公告范围能够可靠比较时给出结构化 `affected` 或 `not_affected`；无法可靠比较的四段构建版本或缺失版本范围保持 `unknown`；发行版回补必须按实际软件包和厂商公告独立核对，不能截短版本或仅据上游版本号推断修复状态。搜索列表的 `verified:false` 代表引用尚未验证为目标漏洞事实。
