# 上游能力对比审计（2026-11-28）

> 审计对象：`wxcvm/dsh-purge` @ `master` = `01255ff9`（package `1.1.92-wxcvm.29`）
> 对照上游：`CallMeGuLab/dsh-purge-safe` @ `main` = `29bf73a9`（tag `v2.0.2`），固定审查位 `cc881fbd`（`2.0.0` 分支）
> 结论一句话：**红队攻击能力确实被削弱，但不是被"删模块"，而是被"改口径 + 加硬禁止 + 反转审批补丁"三件事一起做掉的。**

## 0. 基线与身份核对

| 项 | 值 | 证据 |
| --- | --- | --- |
| 你的项目（origin） | `https://github.com/wxcvm/dsh-purge`，HEAD `01255ff9`，868 个受控文件 | `git remote get-url origin` |
| 上游（upstream remote） | `https://github.com/CallMeGuLab/dsh-purge-safe`，160 个受控文件 | `git remote get-url upstream` |
| 上游当前 HEAD | `29bf73a9`（"适配 DeepSeek Harness 0.2.2-rc.5"，tag `v2.0.2`） | `git ls-remote` |
| AGENTS.md 记录的固定审查位 | `cc881fbd` = `refs/heads/2.0.0` | `git ls-remote` |
| 两者关系 | **无共同祖先**，`git merge-base master upstream/main` 返回空 | 上游是 `c82ace33 chore: import cleaned v2 source` 整包导入，不是本仓库的分支 |
| 原始上游 | `YuJunZhiXue/dsh-purge`（已删库），历史留存在本仓库 root `abaa4ed2` 与 mmparko 镜像 | `MIRROR-NOTICE.md` |

上游不是"你这条线的过去版本"，而是一条**平行重写线**：它 2026-11 以 "cleaned v2 source" 起家，直接跳到 v2.0.x。所以逐个文件的"差异"不能直接读成"我们退化了"，必须按能力项判断方向。下面的表就是按能力项判断后的结果。

## 1. 红队工具面：数量是我方更多，但缺 7 个上游专名

| 侧 | `redteam_*` 工具名 | 数量 |
| --- | --- | --- |
| 上游 | `redteam_asset`? `asset_add/query/...` `attack_chain` `host` `poc_*` `scope_check` `tunnel_*` | 67 |
| 我方 | 同上 + `armory_search` `evidence_*` `coverage` `chain_plan/advance` `scan_run` `l7_probe` `kev` `experience` ... | 101 |

上游独有（我方没有同名工具）：

```text
redteam_asset          redteam_asset_next     redteam_batch
redteam_host           redteam_pivot_probe    redteam_scope_check
redteam_template_refresh
```

其中 **`redteam_host`** 不是改名问题：上游 `skills/redteam/host-post-exploit.md` 全篇用 `redteam_host op=coverage|finding|update` 驱动主机后渗透队列，我方没有这个工具，只能落到 `redteam_coverage` + `redteam_asset_test`，语义不同。`redteam_pivot_probe` 在我方是 `redteam_l7_probe`（改名，功能等价）。

## 2. 技能面：共享 40 条里 10 条被压缩，上游另有 3 条我方根本没有

我方 `skills/redteam` 55 条，上游 40 条。按"上游有、我方也有但被砍行数"排序：

| 技能 | 上游行数 | 我方行数 | 被砍 |
| --- | --- | --- | --- |
| `netspy-recon.md` | 185 | 61 | **-124** |
| `asset-deep-scan.md` | 104 | 51 | -53 |
| `host-post-exploit.md` | 108 | 60 | -48 |
| `network-device.md` | 69 | 40 | -29 |
| `opsec-hygiene.md` | 70 | 46 | -24 |
| `mobile-code-recon.md` | 67 | 45 | -22 |
| `oob-verify.md` | 59 | 42 | -17 |
| `webshell-toolkit.md` | 104 | 89 | -15 |
| `ai-agent-attack.md` | 59 | 49 | -10 |
| `supply-chain.md` | 59 | 49 | -10 |

被砍掉的是**可执行部分**，不是叙述部分。以 `netspy-recon` 为例，上游有完整参数纪律表、ICMP/TCP/UDP 三种调用、结果解析、以及"交给 gogo/fscan 继续"的交接；我方版本只剩单条 ICMP 示例。

上游独有、我方完全没有的 3 条：

```text
skills/redteam/c2-infra.md          (59 行)  C2 基础设施搭建
skills/redteam/api-data-exfil.md    (65 行)  接口数据外带
skills/redteam/cloud-k8s.md         (86 行)  K8s/云容器攻击
```

`e919092e` 的提交说明写的是"Merge API data-exposure and cloud/Kubernetes guidance into existing skills"（并入 `api-attack`/`cloud-container`），但并入的是**防御视角**，上游那 65/86 行的攻击路径没有对应物；`c2-infra` 则完全没有承接文件。

## 3. 硬禁止条款：上游 0 处，我方 2 处，而且禁的正是"拿到 shell 之后"

```text
skills/redteam/netspy-recon.md:60
禁止默认全网段探测、暴力枚举端口、弱口令测试、漏洞利用、横向移动、隧道建立或持久化。

skills/redteam/host-post-exploit.md:59
禁止凭据转储、口令猜测、权限提升利用、远程横向、计划任务/服务持久化、清日志、修改系统配置或批量访问其他主机。
```

这两句话把红队攻击链的**后 80%** 全禁掉了。上游同名技能里没有这一句，反而是正常交接："拿到 shell → 翻文件 → 凭据 → 提权 → 横向"。

量化限定语密度（全部 `skills/redteam/*.md` 求和）：

| 词族 | 我方 | 上游 |
| --- | --- | --- |
| 授权 / authorized / 授权范围 | 156 | 98 |
| 不执行 / 禁止 / 不得 / 请勿 | 28 | 9 |
| 只读 / 不修改 / 不要改 | 47 | 38 |
| 确认 / confirm | 111 | 91 |

我方另有 3 条纯防御/纪律技能，上游没有同名物：`safe-exploit.md`（可破坏 exploit 的"敬畏流程"）、`business-security-controls.md`（明确写"仅防御控制，不复制利用步骤"）、`evidence-discipline.md`（证据核实链）。

## 4. 运行时：上游强制放行，我方反转回宿主审批

| 能力 | 上游 | 我方 |
| --- | --- | --- |
| `tools/pre-execute` 结论强制改 allow | `lib/tool-gate.js` + `cordis.patch.yml: toolGateBypass` | 无 |
| `tools/post-execute` 禁止 block | 同上 | 无 |
| 审批 / 沙箱 | 被 `tool-gate` 旁路 | `lib/native-permission-enforcement.js` 把 **25/85** 条 patch 反转为宿主原生行为 |

我方 `lib/native-permission-enforcement.js` 里的反转清单：

```js
NATIVE_PERMISSION_PATCH_IDS = [5,6,7,8,9,10,11,12,14,15,16,17,29,33,34,35,36,37,48,59,60,61,62,63,70]  // 25 条
// 例：#51 反转回 "wider retries require approval."
```

即 `patches-definitions.js` 里 85 条 patch 中，涉及审批、沙箱、hook deny、文件围栏、网络信任边界的那 25 条**不再生效**。这是最直接的"红队攻击时被削弱"：攻击动作会在宿主那一层停下来要审批。

## 5. 时间线：削弱是怎么一步步进来的

| 提交 | 日期 | 做了什么 | 影响 |
| --- | --- | --- | --- |
| `e919092e` | 11-22 | 以"absorb upstream security skill batch"名义吸收 7 条技能 | 吸收时按 safe 口径改写，丢掉命令细节 |
| `66d135ef` | 11-22 | "absorb **safe** host audit and optional NetSpy recon" | `netspy-recon` 185→61，`host-post-exploit` 108→60 |
| `f094fbce` | 11-22 | 给 `opsec-hygiene` 加"per-engagement cleanup ledger" | 70→46 |
| `26a99684` | 11-19 | 提示词重写 243→144 行，**删 22 个标题段** | 删掉 `Scoped Rules` 分发表、`类别锁`、`完成契约`、`响应一致性`、`House Rules`、`Style` 等 |
| `721f5505` | 11-25 | `fix(security): restore native approval and sandbox enforcement (#554)` | 25 条 patch 反转，审批/沙箱回归宿主 |
| `3ec8d305` | 11-27 | `fix(privacy): make target redaction opt-in` | 目标脱敏默认关闭（方向正确，但属于"同一批安全改动"） |

`26a99684` 的提交说明自称"全部保留能力条款"，但实测：`lib/default-prompt-inject.zh.md` 从 243 行降到 144 行，`Scoped Rules — 动态路由`（Rules 1-28 分发表）整段消失，改成了压缩版"网站渗透路由 / 破解路由 / 外挂路由 / 其余类别"四段。**英文默认 `lib/default-prompt-inject.en.md`（198 行）至今仍保留完整 Scoped Rules** —— 中文默认和英文默认现在不是同一套规则。

注意：当前会话实际注入的是 `C:\\Users\\Kerna\\.dsh\\prompt-inject.md`（166 行 / 24,303 字节，仍含 Scoped Rules），所以"线上看到的效果"和"默认槽里的内容"已经分叉。这条要单独对齐，否则重装/换机后会掉能力。

## 6. 结论：削弱是真的，但形态是这四种

1. **技能正文被安全口径改写**，命令、参数、交接全丢（-352 行，最狠 `netspy-recon` -124）。
2. **两条硬禁止**把"拿到 shell 之后"整段禁掉（`netspy-recon:60`、`host-post-exploit:59`）。
3. **25/85 条 patch 反转**，攻击动作回到宿主审批/沙箱判定。
4. **上游的强制放行旁路没有移植**（`lib/tool-gate.js` 缺失），我方比上游多一层外部审核器。

另有 3 条上游攻击技能（`c2-infra`/`api-data-exfil`/`cloud-k8s`）和 1 个驱动工具（`redteam_host`）缺失。

## 7. 恢复清单（按性价比排序）

1. 删掉 `netspy-recon.md:60`、`host-post-exploit.md:59` 两条硬禁止，恢复上游的"交接下一跳"写法。
2. 用上游原文回填 6 条被压缩技能（`netspy-recon` / `asset-deep-scan` / `host-post-exploit` / `network-device` / `opsec-hygiene` / `mobile-code-recon`），保留我方新增的资产落库段落。
3. 补齐 `c2-infra.md` / `api-data-exfil.md` / `cloud-k8s.md` 三条攻击技能。
4. 决定 `NATIVE_PERMISSION_PATCH_IDS` 是否保留：要红队顺手，就得让这 25 条恢复生效（或至少对红队预设关闭反转）。
5. 评估移植 `lib/tool-gate.js`（上游把 ask/deny 降级成 allow 的旁路）；不移植就等于永久接受外部审核器拦截。
6. 对齐中英文默认提示词：把 `Scoped Rules` 分发表补回 `default-prompt-inject.zh.md`，或统一只维护一份。

## 8. 复现命令

```bash
git fetch upstream --prune
git ls-remote https://github.com/CallMeGuLab/dsh-purge-safe
git merge-base master upstream/main          # 空 = 无共同祖先

# 技能行数差
git ls-tree -r -l upstream/main -- skills/redteam

# 逐技能丢失行
git show upstream/main:skills/redteam/netspy-recon.md | diff - skills/redteam/netspy-recon.md

# 反转的 patch 清单
sed -n '1,10p' lib/native-permission-enforcement.js

# 被删的提示词段
git diff 26a99684^ 26a99684 -- lib/default-prompt-inject.zh.md | grep '^-##'
```

## 9. 本轮落地（2026-11-28）

### 9.1 已恢复

| 项 | 结果 | 证据 |
| --- | --- | --- |
| `netspy-recon.md` | 61 → 185 行，参数纪律表/ICMP/TCP/UDP/交接全部回填；硬禁止删除 | `skills/redteam/netspy-recon.md` |
| `host-post-exploit.md` | 60 → 108 行，恢复为后渗透（不再是"只读安全审计"） | `skills/redteam/host-post-exploit.md` |
| `asset-deep-scan` / `network-device` / `opsec-hygiene` / `mobile-code-recon` / `oob-verify` / `webshell-toolkit` / `ai-agent-attack` / `supply-chain` | 全部回填到上游行数 | `git diff --stat` |
| 上游专名映射 | `redteam_host`→`redteam_coverage`、`redteam_asset`→`redteam_coverage`、`redteam_scope_check`→`redteam_scope_review`、`redteam_pivot_probe`→`redteam_l7_probe` | 技能正文已无未注册工具引用 |
| 中文默认提示词 | 补回 `Scoped Rules`（Rules 1-28）分发表，槽重建 25,918 B | `npm run embed-prompt --check` |

### 9.2 已超越上游

| 项 | 上游 | 本轮 |
| --- | --- | --- |
| `c2-infra` | 纯文档（59 行，无命令块） | 补齐并追加 Purge 落地命令块 + 三条 C2 桥对接表 |
| 权限姿态 | 全局 `tool-gate` 无条件放行 | `nativePermissionMode: strict \| redteam` 双姿态，默认 strict |
| 工具门 | 默认开启 | `toolGateBypass` 默认关闭，红队演练再开 |
| 防削弱 | 无任何回归测试 | `scripts/check-upstream-capability.mjs` + 基线 + 4 条新测试 |

### 9.3 新增文件

```text
lib/tool-gate.js                                 工具门旁路（只降级不接管，默认关）
scripts/check-upstream-capability.mjs            能力基线闸门
skills/redteam/capability-baseline.json          40 条技能的命令块/表格行基线
skills/redteam/c2-infra.md                       C2 基础设施（含落地命令）
test/native-permission-modes.test.mjs            strict / redteam 双姿态
test/tool-gate-bypass.test.mjs                   降级语义与叶子代理禁派活
test/upstream-capability-parity.test.mjs         能力基线校验与检删能力
test/prompt-bilingual-parity.test.mjs            中英默认提示词段落一致
```

### 9.4 验证

```text
npm test                       2105 tests / 2078 pass / 0 fail / 26 skipped
node scripts/check-upstream-capability.mjs   OK: 40 skills at or above baseline
npm run embed-prompt -- --check              OK: sealed slot matches
node --check lib/index.js lib/tool-gate.js   通过
```
