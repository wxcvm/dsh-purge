# 注入槽体检与 upstream-safe 载荷解密

## 现象

插件已装、注入开关 ON、`prompt-inject.md` 存在，但模型只输出模板文字、不调用工具。典型表现是收到「读一下 package.json」这类任务时，回一段说明或占位流程，而不是读文件。

## 根因

`prompt-inject.md`（用户槽）与 `lib/upstream-safe/asset-table.js`（密封默认稿）是两份不同的文本，槽位优先级更高。若槽位被替换成残片，密封稿里的强制执行段会整体失效。

残片与完整稿的关键差异：

| 位置 | 完整稿 | 残片 |
|---|---|---|
| 槽位动词 | `→ run:` | `→ output exactly:` |
| 强制段 | `ACTION vs PRINT (mandatory)` | 整段缺失 |
| 语义 | 工具存在时本轮必须先发 tool_call | 只打印模板行 |

只要 `output exactly` 出现，模型就会退化成打印器。这是可检测的确定性信号。

## 密封载荷结构

`lib/upstream-safe/asset-table.js` 内联一张分片表：

```js
const SLOT_ROWS = [ "B0C2UEaID2...", /* 182 行 */ ];
export const SLOT = SLOT_ROWS.join("");
export const MASK = "S0w4vEY+wlzUqNajXDVA1w==";
export const TAG  = "nwWXxzbjb+vii84p5mhiFA==";
export const IV   = "AcRYE18NIqfy2TGs";
```

`lib/table-key.js` 的 `mixKey(MASK)` 以 `sha256("cordis.slot.v2\x1edsh-purge\x1esurface:web|desktop\x1eov.table.1\x1e" + MASK)` 派生 32 字节密钥，正文为 AES-256-GCM 密文 + zlib(deflate) 压缩。

解密链：

```
SLOT(base64) → AES-256-GCM(key=mixKey(MASK), iv=IV, tag=TAG) → inflate → UTF-8 正文
```

`lib/upstream-safe-prompt.js:readUpstreamSafePrompt()` 走的就是这条链，并在 `route.id === "redteam"` 或 `route.reason === "bundled-default"` 时用解密结果替换槽位文本。`upstreamSafeAssemblyProbe()` 只报告组装层，不报告真实投递，因此槽位内容异常时诊断看不出来。

## 用法

```bash
# 解密密封稿（找不到仓库内资产时自动退到已安装插件）
node scripts/decrypt-upstream-safe.mjs
node scripts/decrypt-upstream-safe.mjs --out upstream-safe.md
node scripts/decrypt-upstream-safe.mjs --lib /path/to/plugin/lib

# 体检当前槽
node scripts/audit-inject-slot.mjs
node scripts/audit-inject-slot.mjs --json
node scripts/audit-inject-slot.mjs --slot /path/to/prompt-inject.md
```

退出码：`0` 完整，`1` 残缺，`2` 无法判定。

## 修复

体检为 `truncated` 时，把解密正文写回槽位（保留 `<!-- dsh-purge:keep -->` 标记，防插件同步覆盖），新会话或下一轮 pre-step 生效：

```bash
node scripts/decrypt-upstream-safe.mjs --out /tmp/full.md
# 剥掉 chatml 信封后写入 $DSH_HOME/prompt-inject.md，末尾保留 keep 标记
```

修改前先备份原槽，回滚就是把它复制回去。

## 注意

`asset-table.js` 随 npm 包分发，不一定存在于较早的源码分支。仓库 `lib/` 下没有该目录属于正常，脚本会自动退到 `$DSH_HOME/plugins/dsh-purge/lib`。用 `--lib` 可以显式指定。
