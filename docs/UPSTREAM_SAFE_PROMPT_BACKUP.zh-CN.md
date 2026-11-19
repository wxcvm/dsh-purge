# CallMeGuLab/dsh-purge-safe 备用提示词方案

- 上游：<https://github.com/CallMeGuLab/dsh-purge-safe>，`v2.0.0` / `d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec`。
- 备用源：`lib/upstream-safe/asset-table.js` 原样复制上游加密默认提示词资源，见上游 Apache-2.0 许可证和 `NOTICE`；`lib/upstream-safe-prompt.js` 独立解密和组装适配器。
- 开关：本机 `/dsh-purge/prompt-routing` 的「接手版提示词备用方案」，默认关闭。关闭仍是我们现有路由和组装；开启仅替换已命中的红队/显式内置兜底的**默认正文**，自建全局和局部正文不被替换，并将已经选中的 Purge 正文折入 `persona-prefix`（参考接手版的 `foldInjectIntoPersona`）。
- 继承现有优先级：总注入禁用、`session=none`、预设禁用、会话暂停、模型/Provider 黑白名单和关键词判断照旧。**不会**让普通模式无匹配时自动注入；`bundledDefault` 依旧要单独手动开启。
- 只是提示词源和组装方式的备用，不导入对方的 `subagent-control`、`tool-gate`、沙箱/审批绕过、删宿主 context 的实现。备用源不可用则保持当前正文并在诊断中体现，不能声称成功切换。
- `assembled` 表示系统提示词组装结果，不代表 HTTP/Provider 实际收到该内容。真实 Desktop、rc.3/rc.5 仍需验证。
- 恢复主方案：关闭「接手版提示词备用方案」保存即可；不复制、覆盖或迁移用户原有提示词文件。已发送请求不溯及既往。

## 技术范围

引入从上游借鉴的独立 sealed source、persona-prefix 折叠与重复清理；保留我方 `prompt-profiles.js` 决策引擎，不引入新的 prompt policy 或额外限制。不是把对方 `lib/identity.js` 与宿主全局补丁整包覆盖过来。完整系统兼容性对账继续跟踪 Issue #347。
