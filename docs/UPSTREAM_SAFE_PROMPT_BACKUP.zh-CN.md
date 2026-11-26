# CallMeGuLab/dsh-purge-safe 备用提示词方案

- 上游：<https://github.com/CallMeGuLab/dsh-purge-safe>，`v2.0.0` / `d96c5f25ee40096417e27fd7a38ee9bdd0dc43ec`。
- 备用源：`lib/upstream-safe/asset-table.js` 原样复制上游加密默认提示词资源，见上游 Apache-2.0 许可证和 `NOTICE`；`lib/upstream-safe-prompt.js` 独立解密和组装适配器。
- 开关：本机 `/dsh-purge/prompt-routing` 的「接手版提示词备用方案」，默认关闭。关闭仍是我们现有路由和组装；开启仅替换已命中的红队/显式内置兜底的**默认正文**，自建全局和局部正文不被替换，并将已经选中的 Purge 正文折入 `persona-prefix`（参考接手版的 `foldInjectIntoPersona`）。
- 继承现有优先级：总注入禁用、`session=none`、预设禁用、会话暂停、模型/Provider 黑白名单和关键词判断照旧。**不会**让普通模式无匹配时自动注入；`bundledDefault` 依旧要单独手动开启。
- 只是提示词源和组装方式的备用，不导入对方的 `subagent-control`、`tool-gate`、沙箱/审批绕过、删宿主 context 的实现。备用源不可用则保持当前正文并在诊断中体现，不能声称成功切换。
- 原生 `persona-prefix` 含插值模板（如 `{{cwd}}`）时，不强行改成 `interpolate:false`；备用源保留，但交付使用单独 `dsh-purge` 段，诊断的 `assemblyMode=native-section` 标识该兼容回退。正常折叠标为 `persona-prefix`。关掉备用时仅清除自有标记，保留原生正文空白和模板。
- `assembled` 表示系统提示词组装结果，不代表 HTTP/Provider 实际收到该内容。真实 Desktop、rc.3/rc.5 仍需验证。
- 恢复主方案：关闭「接手版提示词备用方案」保存即可；不复制、覆盖或迁移用户原有提示词文件。已发送请求不溯及既往。

## 在清洗台的同一提示词工作区使用主副方案

「清洗台 → 提示词管理」现在同时展示全局正文、GPT / Claude / Gemini / GLM 家族适配、局部规则、接手版副方案与可展开的红队专用正文，不需要再跳到独立的备用路由 HTML 页面。

- **主 / 副方案**：直接在「副提示词系统」切换接手版备用方案并单独保存，后端继续使用已有的 `upstreamSafeBackup` 配置和权限校验；普通路由开关的未保存更改不会被副方案的保存顺带提交。默认关闭，旧宿主没有返回来源状态时不允许猜测或保存。
- **可读取 ≠ 已注入**：页面仅从宿主取得封装备用来源的资源可用性、版本及字节数，不读取或显示其加密明文；主 / 副方案状态仍不代表某次会话已经组装或 Provider 已收到。
- **模型家族适配**：页面查看的是后端同一份 `model-overlay.js` 的实际内置 GPT、Claude、Gemini、GLM 适配段；它是可开关的内置附加指导，并非四份可编辑主提示词。若要为模型编写自己的正文，可点击对应家族的「建立 / 编辑专属规则」，在现有局部规则编辑器中生成**默认停用且尚未保存**的模型 ID 白名单草稿，调整、启用并保存后才可能参与自动路由。
- **红队主提示词**：同页展开原有 `prompt-inject.md` 编辑器，仍通过现有读取、保存、恢复接口处理，不把它合并进通用正文或覆盖用户的文件。

如果接口返回 `local-only`、读不到已保存状态或旧宿主没有提供模型段，页面应显示未确认，保留编辑草稿；不能凭前端显示就判定运行宿主或 Provider 已生效。官方 rc.5 Desktop 与真实网络 Provider 仍单独验收。

## 技术范围

引入从上游借鉴的独立 sealed source、persona-prefix 折叠与重复清理；保留我方 `prompt-profiles.js` 决策引擎，不引入新的 prompt policy 或额外限制。不是把对方 `lib/identity.js` 与宿主全局补丁整包覆盖过来。完整系统兼容性对账继续跟踪 Issue #347。

## 备用来源状态与回退验证（2026-11-20）

- 本地配置接口 `/dsh-purge/prompt-routing-settings` 仅返回 `backupSource.ready/code/bytes/version`，不返回提示词正文。页面明确区分“资源可读取”和“已组装/实际模型投递”。
- 备用正文折叠进入原生 `persona-prefix` 时，在当前组装对象上临时记录原生 `order/interpolate` 的原值；再次组装/关闭备用会精确恢复原生属性（包括原本不存在的字段），不保留伪造的空 `persona-prefix`。重用或 JSON 克隆后仍可恢复。
- 含 `{{cwd}}` 等宿主插值模板的原生段继续采用独立 `dsh-purge` 提示词段，不改变宿主插值约定；日志里的 `assemblyMode=native-section` 为有效兼容模式，不应被当成注入失败。
- 单元与官方 Harness 渲染测试只证明 assembled/rendered 的有效性，仍需在真实 Windows Desktop 对 Provider 实际请求体做只读核对后，才能把最终投递标记为验证成功。
