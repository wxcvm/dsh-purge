# Purge × ARTEX 联合发版准备（更新：2026-11-18）

> **状态：发版准备，不是已发布、已通过实机验收或单一联合安装器。**
> 两个项目各自构建、打标签和发布；配套版本与使用说明协同交付，不复制对方源码或私有安装凭据。

## 一、配对基线（核对时间：2026-11-18）

| 项目 | 默认分支及本次核对提交 | 已发布版本 | 本轮目标 |
| --- | --- | --- | --- |
| [Purge](https://github.com/wxcvm/dsh-purge)（Private） | `master` / `5eeeadbdf9c57a2b1f92ea8a9357a3409e418425` | [v1.1.92-wxcvm.9](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.9)（已见 ZIP 与 SHA256SUMS.txt；该标签源码不是 .10 完整集成基线） | `1.1.92-wxcvm.10`，尚无对应标签或 Release |
| [ARTEX](https://github.com/wxcvm/ARTEX)（Public） | `main` / `0a548c564bfd98036d78c4e011639eb369a2a9a4` | [v0.5.1](https://github.com/wxcvm/ARTEX/releases/tag/v0.5.1)（Windows Setup/Desktop/跨平台 ZIP 与 SHA256SUMS） | `v0.6.0` 联合候选；`CHANGELOG.md` 已有 `[0.6.0]` 章节，已补齐 #154 资料、#156/#160 联动及 #164–#170 可选 Runner 说明；正式发版前仍需核对最终构建，尚无正式标签或 Release |

ARTEX [PR #154](https://github.com/wxcvm/ARTEX/pull/154) 已合并至 `main`；吸收的是 164 条**未验证**的富江资料索引条目，不包含 payout-hunt 脚本或主动目标操作。资料导入不等于可用于真实资产的已验证结论。

### CI 证据及剩余检查

- Purge `master` 提交 `5eeeadbd`：[Windows + WSL CI #44089018156](https://github.com/wxcvm/dsh-purge/actions/runs/44089018156) 已成功；`.10` 的 Release `dry_run: true` 尚未执行，不能视为打包成功。
- ARTEX `main` 提交 `77656618`：[CI #44213878051](https://github.com/wxcvm/ARTEX/actions/runs/44213878051) 已完成 Go、Engineering、Web、Windows、Desktop 全五项成功；后续文档 PR [#171](https://github.com/wxcvm/ARTEX/pull/171) 的 [CI #44214079415](https://github.com/wxcvm/ARTEX/actions/runs/44214079415) 也全五项成功并已合并。
- ARTEX 最终 `main` 为 `0a548c56`，其 [CI #44216226434](https://github.com/wxcvm/ARTEX/actions/runs/44216226434) 于本次核对时仍运行中；**必须以该提交最终结果为准**，不能用前次成功运行替代。
- 若两个默认分支再有代码提交，以最终打包提交重新核对 CI，不把旧提交或 PR 结果冒充发布结果。

## 二、联合交付范围

1. **Purge 独立插件包**：维持当前 Harness Desktop/Web 扩展及其私有仓库授权安装/更新机制，不公开发布私有下载凭据，不把私有源码塞进 ARTEX 的公开安装包。
2. **ARTEX 独立程序包**：维持 Windows Setup、Windows Desktop ZIP 和已有跨平台 ZIP；保留 PostgreSQL 与 WebView2 的既有依赖说明，不承诺安装器附带 PostgreSQL。
3. **已有本机联动**：Purge「作战台 → 资源 → ARTEX」检查 `127.0.0.1:8787/api/health` 的明确服务身份；发现并复用本机 ARTEX Tools 目录中的既有工具；知识库与资产关联按现有只读实现工作。
4. **如实说明边界**：Purge 不会因此自动启动 ARTEX、不自动同步任务/Agent/MCP/凭据，也不承诺从 Purge 直接执行 ARTEX Agent。知识库条目来源和验证状态必须保持可见。
5. **升级保留数据**：两端沿用各自备份、恢复与升级逻辑，禁止为了联合发布重置配置、用户 Skills 或数据库。

两项目各自遵循其已有许可证和第三方声明；联合发布不意味着合并许可或让私有 Purge 获得 ARTEX AGPL 代码的豁免。

### 2026-11-17 联动功能追加（主分支已合并，非实机验收）

- Purge [#326](https://github.com/wxcvm/dsh-purge/pull/326)：本机 ARTEX 在线时提供「打开 ARTEX 情报同步」，直接进入 `/function/sync?tab=purge-intel`；原「打开 ARTEX」入口不变。对应主分支提交 `e215de3` 的 [Windows/Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44081800376) 已成功。
- Purge [#327](https://github.com/wxcvm/dsh-purge/pull/327)：配对保存、解除或刷新时清除旧公司的任务、资产和报告概览。PR 的 [Windows/Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44082437962) 已成功；合并提交 `33290a9`，合并后主分支 CI 需以实际运行结果核对。
- ARTEX [#156](https://github.com/wxcvm/ARTEX/pull/156)：配对公司自动预选，概览发现计数与可读取发现条件一致；[#160](https://github.com/wxcvm/ARTEX/pull/160)：现有资产同步页识别 `?tab=purge-intel` 直达参数。两项 PR 的 [CI #44074115499](https://github.com/wxcvm/ARTEX/actions/runs/44074115499)、[CI #44081378233](https://github.com/wxcvm/ARTEX/actions/runs/44081378233) 均成功；后者合并提交 `943eb9c`，最终主分支 CI 仍应单独核对。
- ARTEX 最新候选仍为 `v0.6.0`，Purge 为 `v1.1.92-wxcvm.10`；ARTEX #171 已合并，配对说明同步到 `main`。可选 Linux Docker Runner 的 Compose 假凭据/代理链路 CI 已覆盖，但不等于真实生产镜像、真实任务、MCP/浏览器子进程或全面沙箱验收。两端尚无目标版本的正式 Release，且未完成 Windows 双端实机联动验收。

**Windows 联合操作验收（以下均未实机执行）：** 安装并启动 ARTEX → 从 ARTEX「资产同步 → Purge 情报」选择受权公司并生成一次配对令牌 → 在 Purge「作战台 → 资源 → ARTEX」保存令牌与公司 ID 并检测配对 → 先读取 ARTEX 公司概览 → 生成同范围历史情报并确认同步 → 回到 ARTEX 情报页查看去重快照/分析 → 在 Purge 读取资产、任务/发现及历史快照 → 更换/解除配对并确认旧概览清空 → 停止 ARTEX 观察离线状态 → 重启并验证重新配对与旧数据保留。测试使用已授权的离线样例，不触发真实扫描；记录截图、宿主版本、双端构建和失败回执，不把后台接口返回 200 当作完整 UI 通过。

## 三、最小联动验收表

| 项目 | 验证方式 | 结果 |
| --- | --- | --- |
| Purge 包装 | `master` 执行 Release 工作流 `dry_run: true`，核对 .10 版本、文件清单和 SHA256（**不发布**） | 待执行 |
| Purge 宿主 | 实际 Windows Harness Desktop 安装/升级 .10 候选，完全退出重启，清洗台/作战台导航、版本身份、工具及知识资源可访问 | 待实机 |
| ARTEX CI | 确认最新 `main` 的 Go、engineering、web、Windows/desktop 均通过 | 前一主分支 `77656618` 全五项成功；最终 `0a548c56` 待完成 |
| ARTEX 安装 | Windows Setup 新装与同位置升级，Desktop 启动/托盘/重连；检查 PostgreSQL 配置、WebView2、配置及 Skills 保留 | 待实机 |
| 双端联动 | ARTEX 启动后 Purge 资源页检测到真正的 ARTEX 服务与版本；ARTEX 关闭后显示离线；自定义安装盘/工具目录能正确发现 | 待实机 |
| 数据边界 | 联动检查不读取管理 Token、不改 ARTEX 数据；知识索引只读，未验证资料不冒充已确认漏洞 | 待实机 |
| 交付 | 分别核对两个 Release 的标签提交、实际 ZIP/EXE 与 SHA256SUMS；Purge 私有下载需要授权会话 | 待正式发布 |
| 回退 | 记录各端最后验证可恢复的安装包/配置与恢复步骤，分别演练后再称通过 | 待实机 |

可复用的检查：
- Purge：`npm test`、`npm run build:client`、`npm run test:all` 与现有双平台工作流；本机诊断 `node scripts/diagnose-artex.mjs`。
- ARTEX：现有 `.github/workflows/ci.yml`，包括 Windows Desktop 与安装器的烟雾测试；这些 CI 结果**不替代用户电脑实机联动测试**。

## 四、实际发布次序（完成验收后）

1. 确定两个最终提交和版本配对；ARTEX 的 `CHANGELOG.md` `[0.6.0]` 章节已补齐 #154 资料、配对和 Runner 限制说明；核对准确的最终范围与发布提交。先确认本轮 `main` CI 全绿及 Windows 联动。
2. 分别准备发布说明：ARTEX 公开说明兼容的 Purge 版本和“Purge 为私有、需单独授权”的边界；Purge 私有 Release 说明包含 ARTEX 对应公开 Release。
3. ARTEX 的 `.github/workflows/release.yml` 在推送 `release/v*` 分支或 `v*` 标签时都会触发**正式发布**；因此发版前只用普通准备分支/PR，**不要用 `release/v*` 作预演**。
4. Purge 先用 `master` 的 Release `dry_run: true` 做非发布预演，再依据实际结果决定正式发布；正式发布设置与现有 `.10` 防旧标签机制保持一致。
5. 发布后分别下载核对资产/校验值，在 Windows 进行最终联动与回退确认；在两端 Release Notes 明确对方的实际已发布版本，不用“latest”代替确定版本。

**停止点：** 此文档仅提供联合发版的事实基线与验收顺序，不创建任何正式标签、不执行 `dry_run: false`、不推送 `release/v*`，也不声称未完成的实机检查成功。

参考：[Purge 版本中心](RELEASE_CENTER.zh-CN.md) · [Purge 作战台指南](OPERATIONS_GUIDE.zh-CN.md) · [ARTEX 操作指南](https://github.com/wxcvm/ARTEX/blob/main/docs/USER_GUIDE_ZH.md)。
