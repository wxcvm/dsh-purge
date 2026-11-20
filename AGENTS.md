# AGENTS.md · Codex/代码代理仓库导航

这是 **wxcvm/dsh-purge** 的仓库级协作导航，供 Codex、DSH 及其他代码代理从根目录读取；**不是运行时配置、发布命令或新增的产品权限限制**。

## 首先阅读

1. **[接手版上游吸收总方案](docs/CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md)**：固定上游源码链接、主/备提示词、Agent Teams、Agent attention/ack、Nuclei/KEV、批处理、UI、数据模型、验收矩阵和下一步工作。
2. **[#347 接手版和社区上游任务台账](https://github.com/wxcvm/dsh-purge/issues/347)**：对应模块已完成/未完成的具体证据与下一轮计划。
3. **[#351 Purge 全项目总台账](https://github.com/wxcvm/dsh-purge/issues/351)**：跨清洗台、作战台、ARTEX、发版/宿主的优先级；不要额外创建相同事项。
4. 已有专项说明：[备用提示词](docs/UPSTREAM_SAFE_PROMPT_BACKUP.zh-CN.md)、[官方 Agent Teams](docs/UPSTREAM_NATIVE_AGENT_TEAMS.zh-CN.md)、[社区来源](docs/COMMUNITY_ABSORPTION_20261119.zh-CN.md)、[工具契约](docs/drill-tools-reference.md)。

## 开发时的基线

- **本仓库**：<https://github.com/wxcvm/dsh-purge>；**重点维护上游**：<https://github.com/CallMeGuLab/dsh-purge-safe>，2026-11-20 审查固定提交 `d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec`；**官方宿主**：<https://github.com/deepseek-ai/deepseek-harness>。
- 打开任务前核对**当前** `master`、开放 PR、对应 CI 与 Issue，不要把文档历史快照当作今天的代码或发布状态；也不要重复实现已经合并的功能。
- 对上游功能执行**来源原文件 → 我方现有实现 → 真实缺口 → 最小充分改动 → 相关测试 → PR/CI → 必要实机验收**的证据链。不要因为名字相似便整包替换 `lib/` 或 `client.js`。
- 用户希望尽量零新增费用、避免过度设计和不必要的多轮同义核查；只解决证实的根因，复用已有 SQLite、任务/Agent 状态、提示词路由、技能索引和宿主工具服务。
- **源码已提交、CI 通过、已合并、真实 Desktop/Provider 验收、已发布**分别记录；不要据此互相推断。涉及用户原有配置、宿主权限或默认行为的变化应明确说明影响，避免擅自增加限制。
- 相关校验脚本以 `package.json` 为准，常用 `npm test`、`npm run build:client`、`npm run test:all`。尽量只跑与变更相关的必要测试；实际可用运行环境与对应 CI 应另注明。

## 把结果写回哪里

- **接手版上游/Agent/知识/UI 的源码差异**：优先更新 [#347](https://github.com/wxcvm/dsh-purge/issues/347) 和对应现有模块 Issue；全项目优先级在 [#351](https://github.com/wxcvm/dsh-purge/issues/351)。
- **实时开发状态**：关联 PR（尤其未合并的 [#385 Agent attention](https://github.com/wxcvm/dsh-purge/pull/385)、[#386 宿主最终请求测试](https://github.com/wxcvm/dsh-purge/pull/386)）。
- 记录原始上游 URL / commit SHA、受影响路径、问题与建议、测试/CI 链接、是否在 Desktop/Provider 验收；不要通过新增重复 Issue 或修改旧公告来掩盖未完成项。

**继续工作请从 [完整执行方案](docs/CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md) 的第 4 节开始。**
