# CallMeGuLab/dsh-purge-safe 备用提示词方案

- 上游：<https://github.com/CallMeGuLab/dsh-purge-safe>，`v2.0.0` / `d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec`。
- 备用源：`lib/upstream-safe/asset-table.js` 原样复制上游加密默认提示词资源，见上游 Apache-2.0 许可证和 `NOTICE`；`lib/upstream-safe-prompt.js` 独立解密和组装适配器。
- 开关：本机 `/dsh-purge/prompt-routing` 的「接手版提示词备用方案」，默认关闭。关闭仍是我们现有路由和组装；开启仅替换已命中的红队/显式内置兜底的**默认正文**，自建全局和局部正文不被替换，并将已经选中的 Purge 正文折入 `persona-prefix`（参考接手版的 `foldInjectIntoPersona`）。
- 继承现有优先级：总注入禁用、`session=none`、预设禁用、会话暂停、模型/Provider 黑白名单和关键词判断照旧。**不会**让普通模式无匹配时自动注入；`bundledDefault` 依旧要单独手动开启。
- 只是提示词源和组装方式的备用，不导入对方的 `subagent-control`、`tool-gate`、沙箱/审批绕过、删宿主 context 的实现。备用源不可用则保持当前正文并在诊断中体现，不能声称成功切换。
- 原生 `persona-prefix` 含插值模板（如 `{{cwd}}`）时，不强行改成 `interpolate:false`；备用源保留，但交付使用单独 `dsh-purge` 段，诊断的 `assemblyMode=native-section` 标识该兼容回退。正常折叠标为 `persona-prefix`。关掉备用时仅清除自有标记，保留原生正文空白和模板。
- `assembled` 表示系统提示词组装结果，不代表 HTTP/Provider 实际收到该内容。真实 Desktop、rc.3/rc.5 仍需验证。
- 恢复主方案：关闭「接手版提示词备用方案」保存即可；不复制、覆盖或迁移用户原有提示词文件。已发送请求不溯及既往。

## 在现有 Harness 查看主副来源

「清洗台 → 提示词管理」顶部的「主 / 副提示词来源」只读显示宿主返回的已保存配置。它与「高级路由设置」的内置兜底开关无关，也不代表当前会话采用了该来源或 Provider 已经收到了它。这里不写副方案；保存三个普通路由开关只提交改动的字段，不会覆盖副方案或其他未动的开关。

如果接口返回 local-only、读不到已保存状态，或旧宿主未返回来源字段，页面报告未确认，不把缺失值当成关闭。编辑过的草稿仍在；「重新读取」只读回设置，不会提交或覆盖草稿。正式发行包、当前在用 Desktop 的加载结果和 Provider 投递继续分别验收。

## 技术范围

引入从上游借鉴的独立 sealed source、persona-prefix 折叠与重复清理；保留我方 `prompt-profiles.js` 决策引擎，不引入新的 prompt policy 或额外限制。不是把对方 `lib/identity.js` 与宿主全局补丁整包覆盖过来。完整系统兼容性对账继续跟踪 Issue #347。

## 备用来源状态与回退验证（2026-11-20）

- 本地配置接口 `/dsh-purge/prompt-routing-settings` 仅返回 `backupSource.ready/code/bytes/version`，不返回提示词正文。页面明确区分“资源可读取”和“已组装/实际模型投递”。
- 备用正文折叠进入原生 `persona-prefix` 时，在当前组装对象上临时记录原生 `order/interpolate` 的原值；再次组装/关闭备用会精确恢复原生属性（包括原本不存在的字段），不保留伪造的空 `persona-prefix`。重用或 JSON 克隆后仍可恢复。
- 含 `{{cwd}}` 等宿主插值模板的原生段继续采用独立 `dsh-purge` 提示词段，不改变宿主插值约定；日志里的 `assemblyMode=native-section` 为有效兼容模式，不应被当成注入失败。
- 单元与官方 Harness 渲染测试只证明 assembled/rendered 的有效性，仍需在真实 Windows Desktop 对 Provider 实际请求体做只读核对后，才能把最终投递标记为验证成功。
