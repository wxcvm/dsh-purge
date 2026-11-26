# 外部分支核对：CallMeGuLab/dsh-purge-safe

> **2026-11-20 状态更新（取代本文的旧结论）**：根据项目维护方提供的继任信息，现将 [CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe) 作为 **wxcvm/dsh-purge 的重点跟踪上游（优先参考来源）**，纳入现有上游审查与差异吸收流程。此处“上游”表示维护与技术参考优先级，**不代表本仓库与其形成 GitHub fork 关系，也不代表 GitHub/本地 Git 的 `upstream` remote 已配置**。此前 2026-11-09 的静态比较保留作历史记录，不再作为当前评价。
>
> 当前核对基线：`CallMeGuLab/dsh-purge-safe@d96c5f25ee40`（v2.0.0，适配 DSH 0.2.2-rc.3）与 `wxcvm/dsh-purge@4d9584da7bf6`（master，包版本 1.1.92-wxcvm.17）。重点跟踪发布/提交、Agent Teams、Agent 等待状态、Nuclei 模板更新、KEV、批量入库、演练台布局与提示词组装。每个功能按差异与真实测试单独评估、按需吸收；**不自动同步、合并、覆盖既有实现或替换当前版本**。其他已登记来源保留，许可与署名逐项核验。追踪台账：[Issue #347](https://github.com/wxcvm/dsh-purge/issues/347)。

---



核对日期：2026-11-09。此页记录一次版本来源对比，不把分支名称或自我描述等同于官方上游身份。

| 项目 | 本维护分支 | 外部分支 |
| --- | --- | --- |
| 仓库 | [wxcvm/dsh-purge](https://github.com/wxcvm/dsh-purge) | [CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe) |
| 检查时的包版本 | `1.1.92-wxcvm.4` | `0.1.0` |
| 包名 | `dsh-purge` | `dsh-purge-safe` |
| 默认分支 | `master` | `main` |
| 声明的 DSH 目标 | 0.2.2-rc.1 / 0.2.1-rc.5 / 0.2.1-rc.2 | 0.2.1-rc.5 / 0.2.1-rc.2 |
| GitHub 可见提交 | 已有持续的修复与 PR 历史 | 检查时只有一个首次上传提交 `d27941b` |

## 当前结论

- **未确认是新的官方上游。** 仅凭同名功能、文案或发布较晚，不能确立仓库的继承、维护或版本领先关系。外部分支目前更像一次独立上传的版本快照。
- 外部分支的 Clean / Drill、提示词管理、预设和技能库，在本分支已有对应模块；不能把这些目录存在本身算作新的能力。
- 外部分支的 `lib/bin-preflight.js` 包含宿主启动前 web 进程回收机制。这类功能涉及真实宿主进程，不能仅复制单文件；需核对与现有端口诊断、宿主版本及卸载恢复路径的兼容性。**本轮没有导入或开启该机制。**
- 外部分支的 `NOTICE` 仅列自身归属，未清晰给出与 YuJunZhiXue 的代码继承说明。其仓库声明 Apache-2.0，但对衍生代码的原始署名与许可链仍需按实际来源核对；本维护分支保持既有 `NOTICE`，本轮没有复制外部分支代码。
- 外部分支文档把公网、私网及生产目标作了额外区分。本维护分支继续使用现有的合法授权原则，不因参考外部分支而新增无必要的功能范围限制。

## 下一步

先完成 Windows Desktop 实际安装验收（运行时注册、侧栏/清洗、技能调用与归档恢复），再按具体缺陷选取外部实现并用已有相关测试验证。若后续有新提交，比较具体函数与行为，而不是仅同步 README 或版本号。
