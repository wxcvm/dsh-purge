# test-pending —— 尚未收编的规格用例

这里的文件**不在** `npm test` 的扫描范围内（`test/*.test.mjs`），跑它要显式：

```powershell
npm run test:pending      # = node --test test-pending/*.mjs
```

## 为什么还留着

`workflow-coordination.mjs` 是从 ChatGPT 版（`破/dsh-purge` 1.1.71-redteam.1）搬来的工具级契约，
按**57 个工具**和那一版的 `redteam_agent_slot` 语义写成。本仓库现在是 **75 个工具**，
`redteam_agent_slot` 用的是「label + 时间戳」键、`used = max(注册表运行数, 预留数)`，
另外还有探测不到宿主的退化态字段差异。硬让它变绿就得回退现在的工具行为，所以留作规格参考。

## 已经收编的部分

前 10 条（设置原子合并、占位簿记、子会话活动归纳）不依赖宿主包，已搬进正式套件：

| 原用例 | 现在的落点 |
|---|---|
| atomic settings merge / 非法既有文件 / 锁竞争 / 目录当文件 | `test/coordination-primitives.test.mjs` |
| keyed reservation / union accounting / unknown activity / run-aware release | 同上 |
| live registry 去重与属性回退 | 同上（实现位于 `lib/redteam/child-activity.js`） |

## 仍卡住的 6 条

| 用例 | 卡点 |
|---|---|
| `slot tool retries at capacity are idempotent…` | 要求 `acquire` 收 `key` 并返回 `reused`，当前实现用 `label` 自动生成键 |
| `concurrent keyed retries…` | 同上，且要求 12 并发只成功 2 个（当前 `used` 取最大值，不是并集） |
| `slot metadata updates after lifecycle events…` | 要求 `subagent/start`、`subagent/end` 事件驱动占位关联 |
| `degraded-registry admission…` | 要求 `capacity_verified` / `admission_basis` / `free_upper_bound` 三个字段 |
| `query wrappers forward requested paging…` | 断言 `definitions.size === 57`，且要求 `redteam_data_quality` 存在 |
| `read-only quality tool…` | `redteam_data_quality` 工具尚未注册（store 侧 `dataQuality` 算子已就绪） |

要真正收编，得先决定：`redteam_agent_slot` 是否切到「key + runId」语义、是否新增
`redteam_data_quality` 工具。两件都会改工具契约，需要同步更新
`docs/drill-tools-reference.md` 与红队预设里的调用说明。
