# 富江破甲离线 CVE 候选索引

来源：[FJNB5/fujiang-pojia](https://github.com/FJNB5/fujiang-pojia) 的 `plugin/knowledge/` 目录，
固定参考提交 [cf086fc](https://github.com/FJNB5/fujiang-pojia/commit/cf086fc329011c6f8eeb3b67f0adbcc3f005debb)。

## 本轮吸收的内容

- **105 条公开漏洞元数据**，覆盖 Java 反序列化、Java Web、云与容器、边界设备、Exchange / AD、Linux 提权及 Web / CMS。
- 仅保留分类、标题、CVE、产品、受影响版本声明、端口、关键词和每条原始资料链接。**未复制上游的 PoC 正文或利用步骤**。
- 数据以 JSON 放在 `lib/redteam/cve-catalog/`，随当前插件包发布，默认纯离线检索。
- `redteam_cve_match` 可直接从现有 SQLite 的 `asset_id` 读取服务/产品/banner/指纹，也可不依赖数据库按 `cve` 或 `product` 查询。不创建第二套任务台账，不自动导入现有漏洞库。
- 匹配返回 `matched_score` 和 `matched_reasons`，结果一律 `status: candidate`、`verified: false`。通用端口不能单独推断漏洞，受影响版本由人工复核或后续证据验证。
- 目前有 **5 组结构化版本范围**：Grafana、Apache HTTP Server、runc、Apache Log4j2、Apache Druid；保留各自的版本分支、修复边界与官方参考链接。版本命中只表示候选适用性，不代表目标已验证。
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
- 这是对全部源条目的防御性内容覆盖，不等于将原始利用正文全部迁入或完成 105 条公告的独立逐一复核。上游文件引用保留原固定提交，上传包的来源路径亦独立保留。
