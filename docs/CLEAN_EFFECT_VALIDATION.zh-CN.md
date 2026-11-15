# 清洗效果专项：真实宿主三组对照验收

本文件用于收集真实 DeepSeek 正常任务的交付质量和效率数据。评测器已在 beta 中实现，本文不引入模型调用服务，也不修改宿主、权限、审批、系统提示或安全拒绝行为。

## 1. 实验配置

- A / host：原始 Harness；B / current：当前 Purge；C / candidate：待验收候选版本。
- 使用实际已安装、可正常工作的独立实验环境或已有测试 profile。记录各组实际版本/提交；不通过修改生产配置来准备对照。
- 三组使用同一个宿主版本、同一个可见模型路由、相同推理参数和相同任务输入。工具、权限和操作系统保持一致；仅比较待测版本的差异。若远端模型修订不可见，记录“未观测”，不要推断版本完全一致。
- 各案例使用独立新会话。保留实际原始最终回答，不能删除前言、Markdown 或错误内容来使 JSON 通过。正常任务的安全拒绝或权限阻塞也应如实记录，不强制重复执行。
- 先做六次 CLI 运行的低成本冒烟：arithmetic 和 multi-step 各在三组运行一次。完整第一轮十项共三十次 CLI 运行；实际 Provider attempt 数可能不同。仅在已有模型额度允许时进行，不自动增加付费。使用采集器 `--full config.json --resume 已有真实matrix.json` 可保留冒烟和中断前已完成样本，仅补采缺失项；已采集错误答案也不重跑。若做重复实验，每轮单独保存数据，交替组顺序以减少顺序效应。小样本不代表总体能力。

## 2. 题目和采集

在仓库根目录执行（PowerShell）：

```powershell
node scripts/evaluate-task-quality.mjs --cases
```

输出全部十项固定正常任务的 ID 和提示。逐项把原文发送给相应测试会话，记录用户可见最终回复，不复制思考过程、凭据、私人会话内容或不相关工具参数。

将下面模板保存为本地 clean-real-matrix.json，填写实际值。模板中的 captureKind 默认 synthetic，仅作结构示例；实际完成真实采集后改为 real。settings 应包含真实可见的采样参数、推理等级、输出限制等；三组应相同。environment 是三组共同的操作系统及工具/权限环境说明，不含私有路径或密钥。

```json
{
  "captureKind": "synthetic",
  "host": {
    "model": "replace-with-observed-route",
    "hostVersion": "replace-with-observed-version",
    "environment": "replace-with-common-environment",
    "settings": {},
    "variant": "stock",
    "samples": {}
  },
  "current": {
    "model": "replace-with-observed-route",
    "hostVersion": "replace-with-observed-version",
    "environment": "replace-with-common-environment",
    "settings": {},
    "variant": "replace-with-current-version",
    "samples": {}
  },
  "candidate": {
    "model": "replace-with-observed-route",
    "hostVersion": "replace-with-observed-version",
    "environment": "replace-with-common-environment",
    "settings": {},
    "variant": "replace-with-candidate-version",
    "samples": {}
  }
}
```

每个 samples 条目的 key 为任务 ID，value 至少包含 response 字符串。可选 metrics 为 totalTokens、toolCalls、elapsedMs；必须来自实际观测，缺失则省略，不填零。以下是**合成格式示例，不是实测数据**：

```json
{
  "arithmetic": {
    "response": "94",
    "metrics": { "totalTokens": 100, "toolCalls": 0, "elapsedMs": 500 }
  }
}
```

如已获得同一独立会话的原生 session events，可附 events 数组，保留实际 seq、type、必要 data.reason/source 等字段；去除无关敏感内容但不伪造事件。仅在确实有原生生命周期数据时添加 events；不要将 CLI 的其他事件格式冒充 session events。未采集到任务回复的案例留空缺失，实际返回空字符串则保留空字符串。真实阻塞、取消和传输失败应在会话记录/实验备注中报告；不能靠补写一个答案将其算成完成。

## 3. 运行与解读

```powershell
node scripts/evaluate-task-quality.mjs --matrix clean-real-matrix.json
```

- 三组模型/宿主/环境/settings 不一致时拒绝生成可比报告。
- completeCases 表示三组均采集到样本，而不是三组均成功。
- 比较 hostToCurrent、currentToCandidate、hostToCandidate 的正确/错误/格式失败/未完成/缺失及改善和退化数量。
- efficiency 只统计共同正确且双方均有相应测量的案例；不同指标可能有不同样本数。SDK 含缓存 Token 和实际计费 Token 不应混称。
- 当前评测器仅评分固定任务最终回复及可选会话结束状态；尚未测量首轮完成率、宽泛目标自主性或真实长上下文压缩效果，不能从本报告推断这些指标。
- captureKind 和配置是采集者声明，不是独立认证；保留真实运行记录以核查来源。合成夹具、已有自主性 benchmark 数据和本专项真实三组数据分开归档。

## 4. 验收与交付

记录每组实际安装版本、运行日期、实验参数、已完成案例及缺失原因。针对 Hook 修复，在真实 Harness 中另行验证正常任务取消、新任务切换、重载、不同会话隔离，不开启原本关闭的自动续跑来制造测试通过；如使用专门测试 profile 验证已有续跑功能，记录配置并保持生产设置不变。

真实模型或 Windows 宿主未可用时，将该项标记为待实测，而不是“通过”。最终只交付通过必要 CI 和实际适用验收的变更；未完成的真实模型数据、Windows 验收、发布资产应明确列为缺口。此前 PR #225 的真实模型数据属于不同的自主性实验，不代替本协议的三组对照。
