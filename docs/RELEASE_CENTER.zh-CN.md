# PURGE / 版本中心

[返回工作台](../README.md) · [Releases](https://github.com/wxcvm/dsh-purge/releases) · [Actions](https://github.com/wxcvm/dsh-purge/actions) · [开发进度](DEVELOPMENT_STATUS.zh-CN.md)

> 本页为维护快照，不是自动更新接口。实际可下载版本、文件及校验值以对应 Release 为准。

## 当前 Release 查询快照 · 2026-11-20

| 渠道 | 最新可见版本 | 证据与边界 |
| --- | --- | --- |
| 最新 Release | [v1.1.92-wxcvm.18](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.18) | 对应 [`0bd3a58`](https://github.com/wxcvm/dsh-purge/commit/0bd3a58ba1981c61193e898a2d1ba4f3517d7f5d)，已下载 ZIP 与 SHA256SUMS，校验、包内版本和入口通过（见下） |
| 当前 master | [提交历史](https://github.com/wxcvm/dsh-purge/commits/master/) | [发布提交 Windows / Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44724659602) 已通过；后续主分支改动与旧发布包不混同 |
| 实际安装 / Provider | [#336](https://github.com/wxcvm/dsh-purge/issues/336) | 另行验收，不从版本字段、CI 或 Release 可见性推断 |

已校验发布 ZIP 的 SHA-256：`310ec43c2a0821ee1e266dc62e0be2ead876218a51b05b267e74c3501d4b75df`。下载字节、包内清单与版本通过，不等于已安装或已加载。

有关上游接手版和 Codex 实施：[根目录 AGENTS.md](../AGENTS.md)、[上游吸收执行方案](CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md)。发布前仍须执行当前提交的打包、干净配置、Windows Desktop / Web 安装与恢复检查，不能拿 CI 或 .11 的校验结果替代。

## .11 历史验证快照 · 2026-11-18

| 渠道 | 版本 | 状态 |
| --- | --- | --- |
| Stable | [1.1.92-wxcvm.11](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.11) | 已发布；ZIP、SHA-256 与提交 `00975bf` 已核对，安装与重启待实机验收 |
| Stable 历史版本 | [1.1.92-wxcvm.10](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.10) | GitHub 已列出 Release；本轮未重新核对其资产字节 |
| Stable 历史版本 | [.6–.9](https://github.com/wxcvm/dsh-purge/releases) | 仅按各标签及实际 Release 记录判断，不套用 .11 的验收结果 |
| Beta | [独立分支](https://github.com/wxcvm/dsh-purge/blob/beta/package.json) | 以该分支与实际 Release 为准，不自动提升为 Stable |

[.11 交付台账](DELIVERY_STATUS_11.zh-CN.md)分别记录发布资产、本地打包、自动化检查和待实机项。这份工作副本上的诊断修复尚未发布，原标签与资产未修改。

## 发布候选包的干净目录自动验收（非 Desktop 实机）

`scripts/check-packlist.mjs` 仅校验 npm 将打包哪些文件；`scripts/smoke-packed-install.mjs` 进一步从**当前候选源码**实际执行 `npm pack`，校验 tgz 的 npm SHA-1 / SHA-512 元数据与真实归档一致，在全新、可销毁的临时 `DSH_HOME` 内安装该 tgz，验证包内版本、关键文件、五个 Host 插件模块导入（作战台工具模块需在该临时环境额外安装已固定版本的官方 `@deepseek-ai/dsh-tools` 宿主接口）、生成客户端语法和 CLI `--help`。Windows / Ubuntu 的兼容性 CI 均执行该步骤，失败不允许把当前候选标记为打包验收成功。

该检查不会运行 `postinstall`、启动 Harness Desktop、安装到用户已有目录、执行清洗补丁或发送真实 Provider 请求；完成后移除临时目录。**当前主线 package.json 的版本号仍对应上一正式版，不表示从当前主线生成的候选归档就是已发布 .18 的相同字节。** 只有以实际 Release 标签 / 资产 / SHA256 校验后，才能确认发布资产；真实 DSH_HOME 升级、Desktop 加载和 Provider 投递仍按 #336/#337/#340 单独记录。

## 后续发布预检

- 固定候选提交，确认包内版本、标签、必要运行文件和 SHA-256。已发布版本不使用相同标签替换资产。
- `dry_run: true` 可在授权的发布工作流中只做归档检查；预检日志不能替代实际下载资产校验。核对候选提交上的 CI，不借用其他提交的结果。
- Windows Desktop 与 Web 独立记录干净配置安装、现有配置升级、重启重连和故障恢复。真实宿主未跑时明确写「未验收」。

## 如何判断版本状态

| 阶段 | 核对位置 | 完成条件 |
| --- | --- | --- |
| 1. 源码 | package.json、目标分支 | 版本号及提交确定 |
| 2. CI | [Actions](https://github.com/wxcvm/dsh-purge/actions) | 对应提交的必要构建与测试通过 |
| 3. 标签 | [Tags](https://github.com/wxcvm/dsh-purge/tags) | 标签指向预期提交 |
| 4. Release | [Releases](https://github.com/wxcvm/dsh-purge/releases) | 目标版本发布，正确资产及校验文件可访问 |
| 5. 实机 | 验收记录 | 对应宿主、安装方式、版本与真实运行结果有记录 |
| 6. Stable 提升 | [Pull requests](https://github.com/wxcvm/dsh-purge/pulls) | 明确批准并完成目标分支合并 |

预览版不自动等于正式版。不要用旧版本的验收结果替代新版本实机验收。

## 私有交付

- 在已登录且具备仓库权限的 GitHub 会话中访问 Releases，选择明确的版本和实际上传资产。
- 若版本提供 SHA256SUMS，下载后核对相应文件的 SHA-256；没有校验文件时不记录为已完成校验。
- 匿名安装地址和 codeload URL 不能直接访问私有仓库。#268 已合并授权更新与恢复实现；实际安装、升级和重启结果仍需核验。参见 [更新恢复](UPDATE_RECOVERY.zh-CN.md)。
- GitHub 访问令牌不得写入发布文件、日志或仓库文档。

## 发布与验收记录模板

复制以下字段到每次发布说明或对应 PR，未验证项标为待确认，失败项记录具体结果。

| 字段 | 记录 |
| --- | --- |
| 版本 / 渠道 | 待填写 |
| 源码提交 / 标签 | 待填写 |
| CI 链接 / 结论 | 待填写 |
| Release 链接 / 资产 / SHA-256 | 待填写 |
| Windows Desktop 宿主版本 / 验收 | 待填写 |
| Web 宿主版本 / 验收 | 待填写 |
| 安装、更新、版本切换、重启 | 待填写 |
| 已知问题 / 回滚版本 | 待填写 |

维护约定：每次版本发布或 Stable 提升后更新本页快照；无发布变更的文档 PR 不修改版本号。
