# beta.9 运行观测与质量报告

清洗台 → **运行诊断**。此功能默认仅保存 200 条近期 attempt 的内存元数据，不持久化提示、回答、思考、工具参数或凭据。
每次插件重载清空观测；旧宿主或还没有新模型请求时显示“未观测”，不是“不支持”的确定结论。

## 字段含义

- 首文本延迟：从本地 stream/start 至第一个非空 text-delta；不含启动、请求准备或 reasoning 时间，不能冒充端到端首字延迟。
- 总耗时：同一 attempt 从 stream/start 到 stream/end；采集器另有进程总耗时，两者不要混用。
- 终态：只信任实际 finish 帧。缺少时为 unknown；宿主默认补出的 stop 不作为观测证据。持久事件缺少 finish 时不会抹掉实时终态；实时与持久终态的可见字段不一致时保留实时证据并记录 terminalConflict。reasonSource 区分 host-stream、durable-stream 与 not-observed。
- 结算：committed/abandoned 与回合 completed 是不同维度；都不证明答案正确。替换 Agent 或回合结束但缺少流结束证据时标为 unobserved-end，不伪造耗时或 finish。迟到的持久事件按已提交 seq 对账，不覆盖新 attempt。
- 工具与分片：chunks 为实时分片序号覆盖（最大 index + 1），observedChunks 为实际收到的实时分片数；有缺口时两者可能不同。toolCalls 是实时工具 block-start 计数，durableToolStarts 是匹配持久流中的同类计数（无持久分片为 null）。两者不能相加，也不证明工具已执行。durableTextObserved 仅表示持久流中看到文本，不用于补算首文本延迟。
- Token：实时与持久流分别保留最近的有效 usage 快照及来源。优先使用有总 Token 的持久最终快照，其次是有总 Token 的实时快照；两者不合并字段。空快照不覆盖已观测数据，缺少字段为 null，缓存计费和总 Token 不混称。
- Provider / 模型归因：分别标明 request-header、request-context、assistant-event 或 not-observed。部分 context 不会清除同一次请求头中的已知字段；流开始时消费该请求证据，迟到的持久事件仅用其自身来源补充，不借用新请求路由。没有新证据的 attempt 保持未知。
- Provider 原始终态：rc.3 没有稳定透传保证，本版为 null；不解析私有 replayState 或错误正文。

GET `/dsh-purge/runtime-observations?sessionId=<id>&limit=50` 复用原路由保护，仅返回摘要。limit 上限 200。
页面可见时最多每秒刷新，隐藏/卸载不继续请求；记录淘汰数可见，不能把有限窗口当完整历史。

## 离线评分和本地报告

沿用 `node scripts/evaluate-task-quality.mjs --raw capture.json` 或 `--matrix matrix.json`。
将输出保存为 JSON，在运行诊断页导入；浏览器只显示共享校验器提取的统计字段，不上传原始文件。
每个正常任务样本仍要求原始 response 字符串，可选新增：

```json
{
  "response": "94",
  "firstResponse": "94",
  "repeatedExecutions": 0,
  "metrics": { "firstTextMs": 845, "elapsedMs": 5808, "totalTokens": 6652 },
  "refusalCandidate": false,
  "review": { "verdict": "not-refused" }
}
```

这是格式示例，不是三组真实实验。firstResponse/repeatedExecutions 必须独立采集，不从重复事件推导。
review.verdict 可为 not-refused/refused/unknown。误拒统计只使用已人工复核的正常回复，技术故障和取消排除；没有复核时比率为 null。
不得仅靠关键词、空文本或协议过滤终态判断误拒。上下文诊断只报告重复/冲突事件、工具配对与压缩边界的采集覆盖，不据此宣称丢失。

## 可复现真实采集

`scripts/capture-task-quality.mjs` 仅使用**现存的三个隔离测试 profile**，不会创建/改写 profile 或安装版本。
配置包含绝对路径 exe、cli、dshHome、runtime，以及 host/current/candidate 三项；每项包含 profile、variant、model、hostVersion、environment、settings。
model 使用实际路由 `provider/model`。三组模型/宿主/环境/settings 必须一致；variant/source 身份仍须操作者独立核实。

```powershell
node scripts/capture-task-quality.mjs --preflight capture-config.json
node scripts/capture-task-quality.mjs --smoke capture-config.json
node scripts/capture-task-quality.mjs --full capture-config.json
```

preflight 不调用模型；smoke 为两题六次调用；full 为十题三十次调用，每次使用新进程/会话，无采集器自动重试。
若已有 smoke 或中途中断的真实 matrix.json，可直接续测：

```powershell
node scripts/capture-task-quality.mjs --preflight capture-config.json --resume .scratch/task-quality-旧目录/matrix.json
node scripts/capture-task-quality.mjs --full capture-config.json --resume .scratch/task-quality-旧目录/matrix.json
```

preflight 列出剩余 CLI 运行次数，不调用模型。六个冒烟样本已完成时，完整续测只需剩余 24 次 CLI 运行；已经采集的错误答案也保留，不因正确率重新执行。续测要求原矩阵为 real、三组 profile/variant/model/hostVersion/environment/settings 完全一致；新目录保存合并矩阵与新采集记录，原矩阵及原证据目录不改写。实际 Provider attempt 数可能多于 CLI 次数，不把次数估算当账单。
每个案例核对全部已观测 attempt 的实际路由；任一不匹配或缺失即记录采集失败。探针发生淘汰或 start 数与快照条数不一致时，省略 Token 总量与首文本计时，不将部分记录冒充全量。失败会保留本地部分记录并停止，不补写答案或伪造原生会话事件。配置与报告只放本地 .scratch，不提交模型账号材料。

本机只有通用 codex-review 和生产/default profile，尚未准备三个同条件且对应版本已核实的隔离 profile；因此未运行完整三组对照。
已运行独立 observer-only 探针，证据见 `validation/runtime-observation-20261114.json`。
页面逻辑有 VM 回归测试；新页面实际图形界面、生产部署和在线安装仍未验收。
