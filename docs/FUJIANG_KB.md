# 富江破甲离线 CVE 候选索引

来源：[FJNB5/fujiang-pojia](https://github.com/FJNB5/fujiang-pojia) 的 `plugin/knowledge/` 目录。
首批 105 条固定参考提交 [cf086fc](https://github.com/FJNB5/fujiang-pojia/commit/cf086fc329011c6f8eeb3b67f0adbcc3f005debb)；
后续增量取自发行包 **0.20.13**，条目标 `source_version: "0.20.13"` 并按 `blob/HEAD` 定位上游文件。

## 本轮吸收的内容

- **164 条公开漏洞元数据**，覆盖 Java 反序列化、Java Web、云与容器、边界设备、Exchange / AD、Linux 提权、Web / CMS，以及 0.20.13 新增的 gray-market（业务逻辑 / 越权面）分类。
- 仅保留分类、标题、CVE、产品、受影响版本声明、端口、关键词和每条原始资料链接。**未复制上游的 PoC 正文或利用步骤**。
- 数据以 JSON 放在 `lib/redteam/cve-catalog/`，随当前插件包发布，默认纯离线检索。
- `redteam_cve_match` 可直接从现有 SQLite 的 `asset_id` 读取服务/产品/banner/指纹，也可不依赖数据库按 `cve` 或 `product` 查询。不创建第二套任务台账，不自动导入现有漏洞库。
- 匹配返回 `matched_score` 和 `matched_reasons`，结果一律 `status: candidate`、`verified: false`。通用端口不能单独推断漏洞，受影响版本由人工复核或后续证据验证。
- 指纹匹配只从端口上记录的服务/产品/banner/页面标题，以及 SQLite `fingerprint.evidence` 等实际指纹证据中取信号；**主机名和 URL 自身不会推断组件安装**。需要手工检索时仍可直接输入 `product` / `keyword`。
- 已有 `redteam_poc_search`（本机 PoC/模板）与 `redteam_vuln_add` / `redteam_http_evidence_add`（真实验证记录）继续原样工作。

## 0.20.13 增量（2026-11-16）

- **补齐 6 条既有条目的同链 CVE 号**：上游正文写了整条链，frontmatter 只留主号，首批按 frontmatter 抽取时一起漏掉；补后 ProxyLogon 得 26857/26858/27065、ProxyShell 得 34523/31207、PrintNightmare 得 1675、WebLogic 得 2019-2729 与 2020-14883、Pulse 得 2020-8243。CVE 精确查询数 103 → 113。
- **新增分类 `gray-market` 59 条**：管理 API 未授权、IP 白名单 XFF 绕过、代理层级越权、BOLA、注单流水批量拉取、赔率篡改、支付回调伪造与 SSRF、前端签名可逆、券码枚举、客服记录导出、Druid / phpMyAdmin 暴露、财务导出越权、三方游戏 key 泄露与回调伪造。该分类无 CVE，靠 `product` / `keywords` 命中。
- **别名只按已知产品链补**（脚本里的 `ALIASES` 表），不做全文抓号：正文顺带提到 log4shell 的条目不会被塞进 CVE-2021-44228，精确查询仍是一条。
- **匹配器补中文关键字**：`terms()` 只切 ASCII token，中文 `keywords` 原本一条都命中不了；现在 CJK 关键字按子串命中并计入 `matched_reasons`（`特征词(中)`）。纯端口仍不推断漏洞。
- 导入器：`scripts/fujiang-kb-import.mjs`（默认 dry-run，`--write` 落盘）。CVE-2021-42550（Logback）上游只有一句「同族」提及，没有独立条目，故未收录。

## 为什么不直接安装富江破甲到当前 profile

它会安装 `@deepseek-ai/dsh-prompt-custom`、单独管理提示词文件与 UI。直接并装容易造成提示词、服务及 UI 入口重复。我们吸收检测数据和索引思路，复用自己已经有的存储、工具、权限与回退路径。

## 来源与许可

原仓库的 `plugin/package.json` 声明 MIT；其 `plugin/LICENSE` 写有：

```
MIT License
Copyright (c) 2026 DSH Desktop contributors
```

本分支只提取元数据并保留每条原始链接；尊重上游署名及源码许可。上游条目中的 `verified: false` 没有变成实测结论。对外使用时按具体厂商安全公告与 NVD 再核对版本。

## 当前集成状态

AboutSecurity 的安装、更新、界面技能浏览和可选 DSH 原生 Provider 已在现有「管理 → 技能库」中实现，详见 [独立集成说明](ABOUTSECURITY_INTEGRATION.md)。现有任务卡会附上离线 CVE 候选和已安装技能提示。自动作业链仍使用原来的任务、证据和进度对账系统，没有增加第二套 `campaigns.json`。Desktop 实机调用与新版本发布需单独验收。
