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
- 相关校验脚本以 `package.json` 为准。**CI 用 Node 24**（见 `.github/workflows/compatibility.yml`），源码里有 `node:sqlite`，不要凭 `engines: >=18` 就在 Node 18 上判断测试是否应成功。日常优先 `npm test` 与 `node scripts/build-client.mjs --check`，改客户端源码时才运行 `npm run build:client`。`npm run test:all` **额外包含 `test-pending`，不等于正常 CI 通过门槛**；不要靠删除待完成断言获得绿灯。

## 把结果写回哪里

- **接手版上游/Agent/知识/UI 的源码差异**：优先更新 [#347](https://github.com/wxcvm/dsh-purge/issues/347) 和对应现有模块 Issue；全项目优先级在 [#351](https://github.com/wxcvm/dsh-purge/issues/351)。
- **实时开发状态**：在写代码前查询 [开放 PR](https://github.com/wxcvm/dsh-purge/pulls?q=is%3Apr+is%3Aopen)、[最新 master 提交](https://github.com/wxcvm/dsh-purge/commits/master/) 和对应 CI。历史 #385（Agent attention）、#386（官方 LLM 请求边界）、#387/#388（区间解析/质量采集）、#389/#390（审批/PowerShell 合约）已合并；仍需按各项的**真实 Desktop/Provider 证据边界**验收。别把已合并 PR 当成待写代码。
- 记录原始上游 URL / commit SHA、受影响路径、问题与建议、测试/CI 链接、是否在 Desktop/Provider 验收；不要通过新增重复 Issue 或修改旧公告来掩盖未完成项。

**继续工作请从 [完整执行方案](docs/CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md) 的第 4 节开始。**


## Codex 启动前的最小操作清单

以下操作在**已经获准访问的 Git 克隆仓库**里执行，不要在有未提交改动的工作区盲目 `reset`、`clean`、切分支、覆盖文件或向用户现有 DSH_HOME 安装补丁：

```sh
git status --short --branch
git fetch origin
git log -1 --format='%h %s' origin/master
gh pr list -R wxcvm/dsh-purge --state open
gh issue view 347 -R wxcvm/dsh-purge
gh issue view 351 -R wxcvm/dsh-purge
```

先读 [执行总方案](docs/CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md) 的 **第 0 节：最新事实与启动检查**。根据现有 PR 分支/目标文件确定是否需要新分支；不要自动复开已合并 #385/#386，也不要整包合并与已移植部分重叠的 #378/#254。每轮只提交可核对的改动与测试，并回写原 Issue。

**文件可访问前提**：`AGENTS.md` 位于 Git 仓库根目录，供 Codex 读取克隆后的仓库；它**不在当前 `package.json.files` 的 npm 分发白名单内**。仅拿到旧 Release ZIP / 已安装的插件，并不能保证包含这份交接资料。仓库是私有时，Codex 使用的 GitHub 身份还需有读取权限。
