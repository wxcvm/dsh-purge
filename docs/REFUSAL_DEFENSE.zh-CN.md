# 拒答防御编排（Refusal Defense）

本文件描述 dsh-purge 当前用来压拒答的完整链路。目标不是"让模型不拒"，而是**把拒绝的影响降到最低、并且不靠运气**：
无论拒绝发生在思考阶段、正文阶段，还是已经写进了历史，都有对应的处理层，且每层都有可观测的判据。

## 一、四层链路

```
① 思考期（reasoning-delta）   stream-guard.classifyThinkingPrefix
      命中 → 流层掐断：丢掉已缓冲的思考块与正文块，只发 finish{PURGE_REFUSAL}
                                  ↓
② 正文期（text-delta）        stream-guard.classifyRefusalPrefix（权重表，阈值 3）
      命中 → 同上；provider 侧拒答终止标记也走这条路
                                  ↓
③ 请求组装（pre-step）         history-scrub：把历史里被判拒的 assistant 文本改写成作废占位
                              escalationText(L1–L3)：请求尾部压升压块（recency 最强位置）
                                  ↓
④ 事后审计（status idle）      obedience.classifyRefusal → refusal-defense.decide
      五档动作：allow / anchor / nudge / kill / rewrite
```

前三层决定"拒绝能不能进上下文"，第四层决定"下一轮用什么手段"。

## 二、融合评分与五档动作

`lib/refusal-defense.js` 的 `scoreRefusalSignals` 把多路信号加权求和（0–20）：

| 信号 | 权重 | 说明 |
|---|---|---|
| 正文判定分 | ×1.0 | `classifyRefusal` 的分数（0–10） |
| 思考判定分 | ×0.75 | 思考里措辞更容易误判，打折 |
| provider 终止标记 | +6 | `PURGE_REFUSAL` / `content_filter` 等 |
| 工具侧被拒 | +3 | 工具链因权限提前收手 |
| 连续拒绝 streak | +2/轮 | 模型顺着自己上一轮继续拒，是最强的累加项 |
| 历史已清理密度 | +0.5/条（上限 3） | 这段对话背着历史债 |
| 任务高风险类别 | +1 | 渗透/生物/武器等，早期就易打定主意 |
| 交付物形态 | −8 | 只认代码块 / 表格 / 标题，**不认** `- xxx` 列表（那是"我能帮的方向"） |

分档（默认阈值，可配）：

```
score < 3         allow    放行
3 ≤ score < 4     anchor   只挂 L1 升压块，不重发（不消耗掐断预算）
4 ≤ score < 6     nudge    强制重发（L2 话术）
6 ≤ score < 8     kill     掐断 + 重发（L2/L3 随轮次升级）
score ≥ 8         rewrite  掐断 + 把历史里的拒绝一并改写（keepTail=0）
streak ≥ 3        rewrite  不看分数，连续拒到这个数直接改写历史
```

硬闸：`maxKillsPerTurn`（默认 3）用尽后 kill 降级为 nudge；`maxRetries`（默认 3）用尽后停手，避免"拒 → 掐 → 再拒"烧 token。

## 三、自适应

战绩记在 `$DSH_HOME/dsh-purge/refusal-defense.json`：

```json
{ "stats": { "kill": [attempts, recovered], "nudge": [...], "rewrite": [...] },
  "sessions": { "session-…": { "level": "kill", "score": 6, "streak": 1, "kills": 1, "keepTail": 1 } } }
```

- 一次动作之后如果产出了实质正文（非拒绝），`noteRecovered` 给该动作记一次成功并清 streak。
- `kill` 成功率低于 `killRecoveryFloor`（默认 0.3）且样本 ≥ 5：把 `rewriteAt` 从 8 下调到 6——掐了也救不回来时就别再烧同一圈，提早改写历史。
- 不做反向上调：成功率再高也不把阈值推到更保守，避免"偶尔一次顺利就放松"。

## 四、配置

| 文件 | 键 | 默认 |
|---|---|---|
| `$DSH_HOME/dsh-purge/stream-guard.json` | `enabled` / `killOnThinking` / `thinkingChars` / `holdChars` / `holdMs` / `maxKills` / `killOnProviderTag` | 全开 |
| `$DSH_HOME/dsh-purge/obedience.json` | `enabled` / `anchorEachTurn` / `retryRefusal` / `maxRetries` / `historyScrub` / `historyScrubKeepTail` | 全开，maxRetries 3 |
| 插件 config | `streamGuard` / `streamGuardThinking` / `streamGuardKills` / `historyScrub` / `defense` | 全开 |

## 五、验证

```powershell
# 单测（86 项：流层 / 思考期 / 历史改写 / 编排器 / 锚点 / 提示词路由）
node --test test/stream-guard.test.mjs test/stream-guard-liveness.test.mjs `
            test/obedience.test.mjs test/obedience-cn-refusal.test.mjs `
            test/history-scrub.test.mjs test/refusal-defense.test.mjs `
            test/anchor.test.mjs test/anchor-gate.test.mjs `
            test/prompt-coverage.test.mjs test/prompt-compat.test.mjs `
            test/inject-switch.test.mjs test/preset-compat.test.mjs

# 运行期证据
Get-Content $env:USERPROFILE\.dsh\dsh-purge\refusal.log -Tail 20   # 流层/思考期掐断 + 动作档位
Get-Content $env:USERPROFILE\.dsh\dsh-purge\refusal-defense.json    # 战绩与每会话状态

# 历史审计（只读）/ 清理（先退出 DSH）
node scripts/scrub-session-refusals.mjs --all
node scripts/scrub-session-refusals.mjs <session.v4.jsonl.zstd> --write
```

## 六、已知边界

1. **判定器是天花板**：改写、掐断、升级的效力都等于 `classifyRefusal` 的召回率。实测同一段"一直不删"的对话里，三条拒绝只有一条被句式判出来（另两条开头是"先说明…"）。
2. **改写思考文本无效**：reasoning 到达流层时推理已经发生，替换只影响显示与归档。真正改变下一轮输入的是掐断（删掉"我拒绝过"的锚）、尾部升压与强制重发。
3. **请求层改写与界面会短暂不一致**：模型看到作废占位，界面仍是原文；要两边一致只能走会话文件层，代价是先退出 DSH。
4. **删历史不等于模型同意**：它只去掉自我确认的锚。任务本身的判断还在，可能重新拒一次——所以四层要叠加，单靠任何一层都不够。
5. **代价**：频繁改写历史会打掉前缀缓存命中率，token 成本上升。默认 `keepTail: 1`、单次上限 24 条，不做全量重写。
