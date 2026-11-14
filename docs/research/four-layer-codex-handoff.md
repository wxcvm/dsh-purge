# 四层运行观测实施交接：P0–P3

研究依据：[rc.3 实证修订](four-layer-runtime-research.md)。本轮目标为 beta.9，不晋升 master。

## 已核对的基础

- beta.8 已发布，源码 81041b6；原 #218–#225 的头提交均已包含在该 beta，不重复合并。
- #229–#238 已提供固定任务评测、事实型上下文和续跑生命周期修复；复用而不是重新开发。
- 实际 app.asar 中 rc.3 的 stream 接口、宿主终态类型及持久事件顺序已核实；真实模型最小探针完成。

## P0：契约

以实际安装源码和固定官方 fixture 为证据。agent/assistant-stream 是 emit；request/header 使用 data.header.config。
不能新增已 deprecated 的 agent/request 监听。缺少流式接口时显示未观测，不使旧宿主加载失败。

## P1：只读观测

按 Agent 生命周期 + 会话 + turn/step + attempt 关联。流式片段不作为最终结果。
finish 缺失是 unknown，不采用宿主默认 stop。只记录来源明确的终态、用量、错误码与状态，不记录错误正文或 replayState。
近期内存最多 200 条，优先淘汰已结束记录；重载释放监听，重复/迟到事件不能污染新状态。

## P2：质量

扩展现有 evaluate-task-quality，不破坏既有 CLI。保留正确性评分，新增人工复核、误拒候选、技术故障和上下文采集完整性诊断。
首文本与 reasoning 分开；缺失指标不填零。复核覆盖率和分母明确，样本不足不能宣称改善。
真实三组实验按 CLEAN_EFFECT_VALIDATION 协议，不能用 observer-only 探针代替 full Purge 对照。

## P3：清洗台与交付

复用清洗台新增运行诊断，GET /dsh-purge/runtime-observations 走原访问保护，默认 50 条、最多 200 条。
页面可见时最多每秒刷新；报告在浏览器本地读取，不上传。共享报告投影仅显示校验过的统计字段。
仅修复已复现的上下文问题，不顺便改写模型输出或已有续跑机制。

最终交付需分别记录：新增测试、实际宿主 probe、三组实验完成情况、页面验收、源码/CI、版本/tag/资产和旧版检测新版本结果。
发布使用新版本 beta.9；保留 master/#171。默认不覆盖当前生产安装、不触发在线安装或宿主补丁、不创建备份或执行回滚。
