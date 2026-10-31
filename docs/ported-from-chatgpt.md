# 从 ChatGPT 版（`破/dsh-purge` 1.1.71-redteam.1）移植了什么

对比基准：

| | 本仓库（master） | ChatGPT 版 |
|---|---|---|
| version | 1.1.81 | 1.1.71-redteam.1 |
| dshTarget | 0.2.1-rc.5 | 0.2.1-rc.5 |
| 文件数（排除 .git/.scratch） | 180 | 127 |
| 内容相同 | 30 | — |

ChatGPT 版是在 **1.1.71 老底子** 上加了一层模块化改造，所以不能整棵替换——整替会丢掉本仓库更晚的东西：
服从性硬化（`lib/obedience.js`）、解除内部限制（net-scope / drill-grant / 并发上限）、rc.5 适配记录、武器类 Scoped Rules、注入改稿保留修复。

## 已移植并通过测试（本分支）

| 文件 | 作用 | 测试 |
|---|---|---|
| `lib/host-compat.js` | DSH 0.2.2 要求显式 `additionalProperties`，这里把"省略即开放"的旧语义还原成显式开放，不动执行/权限/激活 | `test/host-compat.test.mjs` ✅ |
| `lib/redteam/preset-compat.js` | 探测宿主 `dsh-tool-subagent-control` 包布局变化，不改用户预设文件 | `test/preset-compat.test.mjs` ✅ |
| `lib/redteam/report-export.js` | 报告导出 CLI 的参数解析与路径安全（`root/engagement/out`，Windows 保留名拦截） | `test/report-export.test.mjs` ✅ 20 条 |
| `scripts/export-engagement-report.mjs` | 配套 CLI 入口（含 `main` 导出） | 同上 |
| `lib/redteam/query-options.js` | 分页契约：非法输入不再变成 `LIMIT -1` | 由 pending 的 store-query 用例覆盖 |
| `lib/redteam/reservation-state.js` | 进程内并发占位簿记（按 root 分桶，重复释放幂等） | 同上 |
| `scripts/check-syntax.mjs` | 一次性语法体检（ESM/CJS 自动判定） | 手动 |
| `scripts/prepare-host-fixture.mjs` | 造宿主测试夹具 | 手动 |
| `docs/compat-maintenance.md` | 宿主兼容维护手册 | — |
| `docs/redteam-workflow.md` | 红队工作流说明 | — |
| `.github/workflows/compatibility.yml` | CI：多 Node 版本跑测试 | — |

## 暂缓（放在 `test-pending/`，不进 `node --test`）

这 4 个用例依赖本仓库还没有的实现，属于"要移植配套内核才能跑"：

| 用例 | 卡在哪 |
|---|---|
| `agent-status.mjs` | 需要 `lib/redteam/tools.js` 导出 `liveRunningChildren` / `reservationStatus`（后者不存在，需新写） |
| `store-query.mjs` | 需要 ChatGPT 版 `store-core.js` 的 `dataQuality` 等查询算子（本仓库 340 KB vs 其 352 KB） |
| `workflow-coordination.mjs` | 同上，依赖 tools 的占位/生命周期接线 |
| `prompt-compat.mjs` | 依赖其 `identity.js` 的装配行为（本仓库已有自己的 override 保留修复） |

## 没有移植的

- `lib/core.js` / `lib/index.js` / `client.js` / `lib/redteam/*` 的整文件替换：ChatGPT 版基于 1.1.71，会回退本仓库更晚的功能。
- `lib/profile-install.js`：与本仓库 `lib/profile-insert.js` 职责重叠（后者已在用），未引入避免双份。
- `LICENSE` / `README`：ChatGPT 版回到 Apache-2.0 单许可，本仓库是 Apache + 商业许可双份。
