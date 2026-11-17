# Purge × ARTEX 联合发版准备（2026-11-17）

> **状态：发版准备，不是已发布、已通过实机验收或单一联合安装器。**
> 两个项目各自构建、打标签和发布；配套版本与使用说明协同交付，不复制对方源码或私有安装凭据。

## 一、配对基线（核对时间：2026-11-17）

| 项目 | 默认分支及本次核对提交 | 已发布版本 | 本轮目标 |
| --- | --- | --- | --- |
| [Purge](https://github.com/wxcvm/dsh-purge)（Private） | `master` / `49a9793ea2b0fd55e7cd0323d8e8a8967594dfc5` | [v1.1.92-wxcvm.9](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.9)（已见 ZIP 与 SHA256SUMS.txt；该标签源码不是 .10 完整集成基线） | `1.1.92-wxcvm.10`，尚无对应标签或 Release |
| [ARTEX](https://github.com/wxcvm/ARTEX)（Public） | `main` / `128f398ecf460fcaf7d72be1efdbbfecc3ba193b` | [v0.5.1](https://github.com/wxcvm/ARTEX/releases/tag/v0.5.1)（Windows Setup/Desktop/跨平台 ZIP 与 SHA256SUMS） | 新版待定，建议以 `v0.5.2` 作为补丁版候选；**先确认最终范围再写入 CHANGELOG、打标签** |

ARTEX [PR #154](https://github.com/wxcvm/ARTEX/pull/154) 已合并至上述 `main`；吸收的是 164 条**未验证**的富江资料索引条目，不包含 payout-hunt 脚本或主动目标操作。资料导入不等于可用于真实资产的已验证结论。

### CI 证据及剩余检查

- Purge `master` 上述提交：[Local Compatibility (Windows + WSL) #44023253317](https://github.com/wxcvm/dsh-purge/actions/runs/44023253317) 已成功。
- ARTEX PR #154：[ci #44067678428](https://github.com/wxcvm/ARTEX/actions/runs/44067678428) 已成功；合并后的 `main`：[ci #44071748370](https://github.com/wxcvm/ARTEX/actions/runs/44071748370) 在本次核对时仍运行中，最终结论**待复核**。
- 若两个默认分支再有代码提交，以最终打包提交重新核对 CI，不把旧提交或 PR 结果冒充发布结果。

## 二、联合交付范围

1. **Purge 独立插件包**：维持当前 Harness Desktop/Web 扩展及其私有仓库授权安装/更新机制，不公开发布私有下载凭据，不把私有源码塞进 ARTEX 的公开安装包。
2. **ARTEX 独立程序包**：维持 Windows Setup、Windows Desktop ZIP 和已有跨平台 ZIP；保留 PostgreSQL 与 WebView2 的既有依赖说明，不承诺安装器附带 PostgreSQL。
3. **已有本机联动**：Purge「作战台 → 资源 → ARTEX」检查 `127.0.0.1:8787/api/health` 的明确服务身份；发现并复用本机 ARTEX Tools 目录中的既有工具；知识库与资产关联按现有只读实现工作。
4. **如实说明边界**：Purge 不会因此自动启动 ARTEX、不自动同步任务/Agent/MCP/凭据，也不承诺从 Purge 直接执行 ARTEX Agent。知识库条目来源和验证状态必须保持可见。
5. **升级保留数据**：两端沿用各自备份、恢复与升级逻辑，禁止为了联合发布重置配置、用户 Skills 或数据库。

两项目各自遵循其已有许可证和第三方声明；联合发布不意味着合并许可或让私有 Purge 获得 ARTEX AGPL 代码的豁免。

## 三、最小联动验收表

| 项目 | 验证方式 | 结果 |
| --- | --- | --- |
| Purge 包装 | `master` 执行 Release 工作流 `dry_run: true`，核对 .10 版本、文件清单和 SHA256（**不发布**） | 待执行 |
| Purge 宿主 | 实际 Windows Harness Desktop 安装/升级 .10 候选，完全退出重启，清洗台/作战台导航、版本身份、工具及知识资源可访问 | 待实机 |
| ARTEX CI | 确认最新 `main` 的 Go、engineering、web、Windows/desktop 均通过 | 待最终完成 |
| ARTEX 安装 | Windows Setup 新装与同位置升级，Desktop 启动/托盘/重连；检查 PostgreSQL 配置、WebView2、配置及 Skills 保留 | 待实机 |
| 双端联动 | ARTEX 启动后 Purge 资源页检测到真正的 ARTEX 服务与版本；ARTEX 关闭后显示离线；自定义安装盘/工具目录能正确发现 | 待实机 |
| 数据边界 | 联动检查不读取管理 Token、不改 ARTEX 数据；知识索引只读，未验证资料不冒充已确认漏洞 | 待实机 |
| 交付 | 分别核对两个 Release 的标签提交、实际 ZIP/EXE 与 SHA256SUMS；Purge 私有下载需要授权会话 | 待正式发布 |
| 回退 | 记录各端最后验证可恢复的安装包/配置与恢复步骤，分别演练后再称通过 | 待实机 |

可复用的检查：
- Purge：`npm test`、`npm run build:client`、`npm run test:all` 与现有双平台工作流；本机诊断 `node scripts/diagnose-artex.mjs`。
- ARTEX：现有 `.github/workflows/ci.yml`，包括 Windows Desktop 与安装器的烟雾测试；这些 CI 结果**不替代用户电脑实机联动测试**。

## 四、实际发布次序（完成验收后）

1. 确定两个最终提交和版本配对；ARTEX 在 `CHANGELOG.md` 写入准确的版本章节。先确认本轮 `main` CI 全绿及 Windows 联动。
2. 分别准备发布说明：ARTEX 公开说明兼容的 Purge 版本和“Purge 为私有、需单独授权”的边界；Purge 私有 Release 说明包含 ARTEX 对应公开 Release。
3. ARTEX 的 `.github/workflows/release.yml` 在推送 `release/v*` 分支或 `v*` 标签时都会触发**正式发布**；因此发版前只用普通准备分支/PR，**不要用 `release/v*` 作预演**。
4. Purge 先用 `master` 的 Release `dry_run: true` 做非发布预演，再依据实际结果决定正式发布；正式发布设置与现有 `.10` 防旧标签机制保持一致。
5. 发布后分别下载核对资产/校验值，在 Windows 进行最终联动与回退确认；在两端 Release Notes 明确对方的实际已发布版本，不用“latest”代替确定版本。

**停止点：** 此文档仅提供联合发版的事实基线与验收顺序，不创建任何正式标签、不执行 `dry_run: false`、不推送 `release/v*`，也不声称未完成的实机检查成功。

参考：[Purge 版本中心](RELEASE_CENTER.zh-CN.md) · [Purge 作战台指南](OPERATIONS_GUIDE.zh-CN.md) · [ARTEX 操作指南](https://github.com/wxcvm/ARTEX/blob/main/docs/USER_GUIDE_ZH.md)。
