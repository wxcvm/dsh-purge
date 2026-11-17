# Purge 提示词规则路由（第一阶段）

本功能先在 Draft PR 中测试；未合并前不会修改已安装的 Purge。

## 选择顺序

1. 当前会话手动锁定的提示词（包括 `none`）
2. 红队预设自动绑定现有 `$DSH_HOME/prompt-inject.md`（原文和编辑方式保持不变）
3. 用户最近一条任务命中配置中的关键词，且未命中排除词，选择优先级最高的启用项
4. 无命中时保持 Harness 原生提示词，不注入旧全局红队正文

目前内建配置：`redteam`、`coding`、`writing`。新增和编辑用户提示词不会修改原 `prompt-inject.md`。

## 本地配置文件

`$DSH_HOME/dsh-purge/prompt-profiles.json`（不存在时使用内置默认配置）：

```json
{
  "profiles": [
    {
      "id": "research",
      "name": "资料研究",
      "enabled": true,
      "priority": 60,
      "keywords": ["资料整理", "研究报告"],
      "excludes": ["不要生成报告"]
    }
  ]
}
```

每个自定义提示词正文为独立 Markdown 文件：

```text
$DSH_HOME/dsh-purge/prompt-profiles/research.md
```

标识只允许英文小写字母开头及英文小写字母、数字、下划线和连字符，以确保文件路径确定。匹配忽略英文大小写，当前是确定性子串匹配，不调用 AI。

会话手动锁定数据存放在 `$DSH_HOME/dsh-purge/prompt-session-locks.json`。代码接口为 `setSessionPromptLock(home, sessionId, profileId)`；`profileId=null` 恢复自动选择，`profileId="none"` 表示该会话不注入 Purge 提示词。**当前尚无界面按钮，后续阶段再接入 UI。**

## 验收边界

- 本阶段仅涉及提示词存储、路由、上下文作用域和原有锚点隔离。
- 不引入模型、不修改原红队正文、不变更原有拒答分析的判定规则。
- 宿主无会话上下文的历史全局兜底不再返回红队正文，以避免跨会话混入。这一差异需要在 Windows Desktop 的实机兼容性测试中确认。
- 多提示词编辑界面、拒答诊断增强、轻量任务调度、ARTEX 适配均属于后续阶段。
