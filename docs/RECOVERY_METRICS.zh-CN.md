# 恢复动作与指标（refusal / stream / upstream）

本文说明运行时三套恢复动作的开关、日志字段与指标口径。所有开关都在
`$DSH_HOME/dsh-purge/obedience.json`，缺省值偏保守：**观测默认开、打断默认关**。

## 开关

| 键 | 取值 | 默认 | 作用 |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | 总开关，关掉后三套动作都不跑 |
| `retryRefusal` | bool | `true` | 良性任务里的明确拒答，允许一次中性复核 |
| `maxRetries` | 0–3 | `1` | 复核次数上限（每会话、每个新请求重置） |
| `continueHollow` | bool | `true` | 空心停摆（本轮没有正文）续跑 |
| `maxContinues` | 0–3 | `1` | 续跑次数上限 |
| `streamWatch` | `off` / `shadow` / `enforce` | `shadow` | 思考流趋势：不观察 / 只记录 / 达阈值打断 |
| `streamWatchScope` | `benign` / `any` | `benign` | 观察范围；`any` 也覆盖红队类任务 |
| `streamWatchMinHits` | 1–6 | `2` | 窗内命中几次才算趋势 |
| `streamWatchWindow` | 200–4000 | `800` | 尾窗字符数 |
| `streamWatchMaxAborts` | 0–3 | `1` | 每会话打断上限 |
| `upstreamSwitch` | `off` / `shadow` / `switch` | `shadow` | 上游策略拦截后：不动作 / 只记会换谁 / 真换档重发 |
| `upstreamSwitchMax` | 0–3 | `1` | 每会话换档次数上限 |

## 三套动作的触发条件

| 动作 | 触发 | 不触发 |
| --- | --- | --- |
| 中性复核 | 最后一条助手正文判定为明确拒答 + 任务属良性 + 预算未用 | 风险上下文、技术限制、引用/复述内容、用户已插话 |
| 空心续跑 | 最后一条助手消息没有正文、没有工具调用、本轮 `completed` | 用户 abort、非 `completed` 结束、预算已用 |
| 流中打断 | `reasoning-delta` 尾窗两次命中 + 尚未出现非空 `text-delta` + 范围内 + 预算未用 | 已交付、影子模式、范围外、预算用尽 |
| 换档重发 | `finish: content_filter` 或 `CONTENT_*` 结构化错误码 + 存在其它启用档位 | 文本判定、宿主包装错误（如 `PI_AI_ERROR`）、预算用尽 |

## 日志

| 文件 | 写入内容 |
| --- | --- |
| `refusal.log` | `{at, session, model, action, score, hits, category}`；复核后追加 `review-outcome:delivered` / `review-outcome:still-refusal` |
| `stream-watch.log` | `{at, session, hits, mode, action}`；`action` ∈ `shadowed` / `skipped-scope` / `aborted` / `budget-exhausted` / `continued` |
| `upstream.log` | `{at, session, action, reason, profileId, from, evidence}`；`action` ∈ `would-switch` / `switch-profile` / `log-only` / `continued` / `restored` |

日志只记计数与类别，不记正文、不记推理原文。

## 指标

```sh
node scripts/refusal-metrics.mjs            # 人类可读
node scripts/refusal-metrics.mjs --json     # 机器可读
node scripts/refusal-metrics.mjs --home DIR # 指定 DSH_HOME
```

口径：

- **挽救率** = `review-outcome:delivered` / (`delivered` + `still-refusal`)。没有结局记录时为 `null`，不拿 0 冒充。
- **影子命中** = `shadowed` 次数：enforce 模式下"本会打断"的样本量。
- **范围跳过** = `skipped-scope`：因为任务超出 `benign` 范围而没有动作的次数，用来判断要不要开 `any`。
- **换档成功率**需配合 `switch-profile` 与随后的 `review-outcome` / 正常交付一起看，单看 `switched` 没有意义。

## 上线顺序

1. 先跑 `shadow`（默认）几天，看 `shadowed` 与 `would-switch` 的量级。
2. 抽查若干条日志，确认没有把引用/复述内容算进趋势。
3. 再开 `enforce` / `switch`，并把 `streamWatchMaxAborts` 保持 1，观察 `budget-exhausted` 是否频繁。
4. 出现 `review-outcome:still-refusal` 偏多时，先看 `byModel` 分布，再决定是调词表还是换模型档位。
