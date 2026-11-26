# 社区 Purge 大吸收 · 来源对照与第一批交付（2026-11-19）

基线：`wxcvm/dsh-purge@cae5fce`，当前正式分支 `master`，版本 `1.1.92-wxcvm.16`。关联现有台账 [#347](https://github.com/wxcvm/dsh-purge/issues/347)、技能与知识事项 [#344](https://github.com/wxcvm/dsh-purge/issues/344)；不是创建一套平行台账。

## 当前已有能力（不要重复引入）

- `skills/redteam/` 已有 **46 个 Markdown 技能**。Community `kingcharleslzy-ai/dsh-purge` 的 23 个红队技能**同名条目均在本分支存在**。同名不意味着正文完全一致，未来只吸收确有价值的内容差异。
- `knowledge-unified.js` 已联邦检索 bundled / personal / cve / redteam / aboutsecurity / artex。当前测试将 bundled 条目总数锁定为 **206**，其中包含富江参考资料；实际部署要另验。
- 富江 105 个 CVE 候选索引、167 篇原始资料归纳与检索、已有 AboutSecurity 可选安装/搜索、ARTEX 来源、技能可用性检查已实现；不要再复制一套个人库或资产台账。
- #247 流式终态冲突/回合归因能力已在 `master` 中有对应源码和测试；不能把旧 PR 整包并入。

## 候选来源与处理方式

| 来源 | 实际增量线索 | 处理方式 |
| --- | --- | --- |
| [yaklang/hack-skills](https://github.com/yaklang/hack-skills) | `skills/` 目录约 103 份独立 `SKILL.md`，涵盖 Web、API、逆向、移动端、取证、AI 安全等 | 第一批通过独立本地源目录发现和按需安装；不覆盖随包技能 |
| [yaklang/yak-skills](https://github.com/yaklang/yak-skills) | 12 份 Yaklang/Yakit 编程与热加载技能，含 examples | 同上；只把 `SKILL.md` 当作技能入口，examples 保留在来源目录 |
| [ZiDuNet/dsh-purge](https://github.com/ZiDuNet/dsh-purge) | 已吸收上面两套 Yaklang 技能，另有卸载/恢复、界面更新体验 | 优先跟原始技能上游；恢复与状态功能另行源码比较 |
| [kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge) | Windows 换包、逐条补丁状态、部分失败判定、提示词/流式兼容 | 重点对照运行机制，不把社区全套补丁直接覆盖 |
| [dongliuwuzhong-arch/DSH-purge](https://github.com/dongliuwuzhong-arch/DSH-purge) | 长会话重复上下文注入修复，来源声明 v1.3.5 | 检查 `surface.nodes` 去重与现有消息机制是否同症；需实机重现 |
| [realMisakaMikoto/dsh-purge](https://github.com/realMisakaMikoto/dsh-purge) | 换包激活状态、宿主版本模块布局兼容 | 对照 #337、#348 的未完成项 |
| [555bbbAAA/dsh-purge](https://github.com/555bbbAAA/dsh-purge) | Windows 重启助手编码、子 Agent 预设失配 | 检查现有重启和预设代码后定向吸收 |
| [CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe) | 相关衍生维护及技能资料 | 与 #347 原有计划合并比较，避免重复 |
| [lzzzz666888/dsh-purge-optimized](https://github.com/lzzzz666888/dsh-purge-optimized) | 23 技能、PoC/EXP 索引和分类分页 | 23 技能已覆盖；只检查分类、分页与来源更新差异 |
| [Minggle/dsh-purge-skills](https://github.com/Minggle/dsh-purge-skills) | 历史技能快照 | 作为文件级变更参考，不直接重复安装 |

许可证：Yaklang 两个上游的根 `LICENSE` 均为 **MIT**；本批次不复制它们的正文进本仓库，明确安装时从原仓库获得源码和 LICENSE。其他衍生版各自核对权利声明，不因 README 自称开源就默认可整包复制。

## 第一批：实际实现范围

- 在 `$DSH_HOME/redteam/external-skills/community/<pack>/skills/` 下按需读取外部技能。支持目录式 `SKILL.md` 和直接的 `.md` 文件；不跟随符号链接，不扫描 LICENSE/README 等非技能说明。
- 各来源使用 `redteam:community/<pack>/<skill-id>` 稳定键。独立于随包 `redteam:<name>` 与 `aboutsecurity:<id>`；避免同名覆盖。
- 继续通过现有 `redteam_skill_search`、`redteam_skill_read` 和统一知识库的 `redteam` 来源浏览和读取，**不创建另一套数据库、服务或自动注入路径**。
- 可按需执行 `node scripts/install-community-skills.mjs` 安装两个 Yaklang 包；使用 `--source hack-skills` 或 `--source yak-skills` 单独安装，使用 `--update` 更新；`--home` 指定对应 DSH profile 主目录。脚本不在启动、postinstall 或更新宿主时自动执行。
- 源目录下的其他代码和 examples **不会被 Purge 作为命令执行**；所有文件内容由用户主动调用技能读取工具时作为参考返回。

## 第一批后续闭环（2026-11-19，PR #368）

- 增加 `lib/redteam/community-skills-manager.js`，让 CLI 与宿主操作共用一套按需 Git sparse checkout 逻辑，不在插件启动时安装。宿主桥接支持 `communitySkillStatus/Install/Update/Remove`，管理两个明确来源。
- 现有「技能库」面板增加 Yaklang 社区包安装、更新、二次确认卸载、来源过滤、每包已读取数量/失败状态；`client.js` 同步生成，不只改了开发源文件。
- 社区包使用独立名称 `community/<pack>/<id>`，可从面板打开正文；未被原生技能注册时依然明确显示「未列入宿主/待确认」，不伪装成 DSH 原生已注册。
- 统一知识检索的社区技能条目返回 `community_source` 与固定上游仓库 URL，详情复用已有只读 `knowledgeUnifiedGet`。
- CLI: `node scripts/install-community-skills.mjs [--source hack-skills|yak-skills|all] [--home DSH_HOME] [--update|--remove]`。仅删除明确来源的 Git 检出，不覆盖或删掉其他目录。
- 上游 Git tree 检查确认：`yaklang/hack-skills@6fbf0bc8` 恰有 103 份 `SKILL.md`；`yaklang/yak-skills@071464c0` 恰有 12 份。示例文档不作为独立技能。
- 本批修复仍需最新 Windows/Linux CI 及真实 Windows DSH Desktop 安装/更新/卸载/搜索/读取验收。**不把已提交或早前的绿色 CI 说成实机完成。**

## 知识检索与展示回归修正

原 `knowledgeUnifiedSearch` 对 redteam/aboutsecurity/CVE 等来源只返回前 20 条，且空关键词不能浏览；接入 115 份社区技能后，会出现「已安装但页面找不到」的体验问题。本批对来源明确选择时支持空关键词浏览，并为 **bundled / personal / cve / redteam / aboutsecurity** 增加稳定 `offset` 分页。全部来源模式仍按关键词分别显示每个来源的首批匹配，更多结果可跳转对应来源翻页。个人资料复用 `knowledgeList` 现有 OFFSET 查询，不另建库。CVE 保留原有 `verified:false` 和精确编号匹配。ARTEX 搜索适配器当前不支持 OFFSET，保持原只读搜索和未知总数，不虚报「可翻页」。

- 前端 `UnifiedKnowledgeTab` 已加入上述来源的浏览、分页、来源详情链接；`client.js` 重新生成。
- 增加多页无重复、空关键词、来源 URL 和边界结果的回归断言。
- 实测/CI 尚以对应提交为准；本记录不把文件数或模拟测试视为 Desktop 真机加载结果。

## 后续批次（与现有 Issues 对接）

1. **知识覆盖**（#344）：检查 AboutSecurity、Yaklang、Community、Fujiang 与 ARTEX 来源间的重合；按缺口扩充防御配置、证据分析、兼容排障和工具使用条目，保留独立来源及版本。
2. **技能与工具体验**（#344 / #343）：在现有技能库页面展示社区来源、已安装/可读取/宿主原生注册状态；评估一键按需安装/更新（复用 AboutSecurity 的操作模式）及搜索排序。
3. **提示词与宿主**（#340 / #337 / #348）：真实会话的 System Prompt 组装证据、无命中原因、长会话去重、Windows 替换/升级时补丁状态、重启后运行状态。
4. **流式与质量**（#341 / #342）：失败/取消/半截输出的真实性诊断；保留宿主真实终态，不把未观测自动记成成功。
5. **知识联动**（#346 / #302）：ARTEX、已有资产、漏洞、任务和证据共用记录 ID；新来源只读索引与引用，不复制敏感数据或多建任务记录。

## 验证边界

本批实现应通过技能目录测试、统一知识检索测试、GitHub Actions 的 Windows/Linux CI。源码存在、CI 通过都不等于 DSH Desktop 已加载；实际安装两个 Yaklang 源、来源检索/读取、切换 Agent、更新后恢复必须分别实测后才能标记交付。


## 来源版本与许可证状态（2026-11-22）

- 技能库来源卡片显示上游许可证状态；安装后读取本机检出的 Git HEAD 和根许可证文件，显示 12 位 commit 与识别出的 SPDX 标识。状态读取只访问本地文件和 Git 元数据，不在页面刷新时联网。
- 未安装的 Yaklang 两个来源显示本次核实的上游根 LICENSE：MIT；安装后以本地检出的 LICENSE 为准。
- 若许可证文件缺失、无法读取或无法识别，分别显示未声明、不可读取或未识别；不把未知状态推断为可再分发授权。
- 版本号使用实际 Git commit，不用分支名或“已更新”字样代替精确来源版本。
