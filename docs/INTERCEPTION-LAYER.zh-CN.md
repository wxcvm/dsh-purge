# 拒答拦截层（stream / provider）— 实现记录与署名

> **Author / 维护**：wxcvm `<133561272+wxcvm@users.noreply.github.com>`
> **实现**：dsh-purge agent（DeepSeek Harness，会话 2026-11-14 ~ 11-15）
> **分支**：`codex/desktop-beta8`（完整构建） · `chore/oss-strip`（私有模块剥离快照）
> **提交**：`7815ae7` feat(purge) · `3d1a9c8` docs(badge) · `9eaab8d` chore(oss)

这份文档是这一层的落点：谁写的、改了哪些文件、怎么验证、哪些还没生效。
代码里没有 `@author` 行——本仓库的历史（300 条里 299 条 `wxcvm`）一直是单一作者署名，
所以这里不往文件头塞名字，只在 docs 里记一次，避免污染 diff。

---

## 1. 分层与文件

| 层 | 文件 | 作用 |
|---|---|---|
| 流式协议 | `lib/stream-guard.js` | 挂 `llm/stream`，扣住 `block-start` + `text-delta`，命中拒绝模板即 kill；`maxKills` 到顶放行 |
| 握手 | `lib/obedience.js` | kill 后留 `pendingRefusals`，idle 时纠偏；下一版请求尾部追加 `[dsh-purge · 拦截后重发 L1..3]` |
| Provider | `lib/provider-steer.js` | 注册 `deepseekLlmApiExtensions` 的 `logit_bias` 字段（探针门控）；读写 `prefill.txt` |
| 线级补丁 | `lib/core.js`（`PROVIDER_PATCHES`） | #89–#93：`delta.refusal`、未知 `stop_reason`、Responses refusal 标记、DeepSeek refusal stop、可选 prefill |
| 生效链 | `lib/asar-mode.js`、`scripts/asar-switch.mjs` | `app.asar` 让位给 `app/`，否则代码补丁读不到 |
| 运维面 | `lib/index.js` | `/guard status\|on\|off\|kills\|prefill\|bias\|asar` + `purge_status` 三行状态 |
| 权重 | `scripts/{gguf-inspect,refusal-score,refusal-ab,finetune-probe}.mjs`、`scripts/abliterate.py` | GGUF 头解析、拒答打分、远程 A/B、训练入口探测、Q4_K 张量正交化 |

## 2. 开关与状态

```powershell
/guard status                      # 三层状态（流式 / provider / asar）
/guard off                         # 关流式拦截（写 $DSH_HOME/dsh-purge/stream-guard.json）
/guard kills 3                     # 每轮掐断上限
/guard prefill <文本>              # assistant 前缀（需补丁 #93）
/guard bias-on                     # logit_bias（需端点接受，先用 scripts/probe 验证）
/guard asar                        # 看 app.asar / app/ 谁在生效
/guard asar-off                    # 让 app.asar 让位（应用需先关闭）
```

载入标记：`$DSH_HOME/dsh-purge/guard-loaded.json`（pid + features），
用来确认"到底加载了哪一版"，别对着旧进程调参。

## 3. 验证

```powershell
node --test test/stream-guard.test.mjs test/stream-guard-liveness.test.mjs `
             test/provider-steer.test.mjs test/asar-mode.test.mjs `
             test/patch-registry.test.mjs test/obedience.test.mjs
# 66 tests / 66 pass
```

`test/patch-registry.test.mjs` 会拿当前宿主文件逐条比对 #89–#93 的 pattern，
并对打完的结果跑 `node --check`——版本漂移时变红灯，而不是静默 skipped。

## 4. 权重路线（结论）

- 远程：`scripts/finetune-probe.mjs` 探测 5 个训练相关端点，本机全部无入口（含识别"200 + `{"error":...}`"假阳性）。
- 本地：`scripts/abliterate.py --run` 对 `qwen2.5-3b-q4km` 的中段 9 层做秩一正交化，产出 2.27 GiB f16，
  LM Studio 可加载（`arch=qwen2`）。
- 打分：`P_refuse` 0.6267 → 0.6505、`hardRate` 0.75 → 0.75、`normalHardRate` 0 → 0。
  **负结果**：`attn_output` 最大左奇异向量不是 refusal direction。
  正向路径留在 `--direction <file.npy>`（activation 均值差），接口已就位。

## 5. 已知未生效

`#89–#93` 写在 `resources/app/`，而 `resources/app.asar` 仍在 → Electron 优先 asar，补丁是死代码。
`/guard status` 会显示 `✗ app.asar 还在`；`/guard asar-off`（应用关闭后跑）才能让它们真正加载。

---

## 署名说明

- **git 层**：`7815ae7` / `3d1a9c8` 的 author 与 committer 都是 `wxcvm`，
  没有 `Co-authored-by` / `Signed-off-by` trailer——工具不抢作者身份。
- **代码层**：唯一溯源标记是功能性的 `[dsh-purge]` / `[dsh-purge-89]`…（补丁 markers），
  用于 `purge_status` 判断 applied/skipped，不是作者签名。
- **文档层**：就是这份文件。
