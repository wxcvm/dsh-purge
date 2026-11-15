# PURGE / 版本中心

[返回工作台](../README.md) · [Releases](https://github.com/wxcvm/dsh-purge/releases) · [Actions](https://github.com/wxcvm/dsh-purge/actions) · [开发进度](DEVELOPMENT_STATUS.zh-CN.md)

> 本页为私有仓库的维护快照，不是自动更新接口。实际可下载版本、文件及校验值以对应 Release 为准。

## 当前版本快照 · 2026-11-15

| 渠道 | 源码版本 | Git 标签 | 状态 |
| --- | --- | --- | --- |
| Stable 历史标签 | 1.1.92-wxcvm.6 | [v1.1.92-wxcvm.6](https://github.com/wxcvm/dsh-purge/tree/v1.1.92-wxcvm.6) | 保留旧标签 |
| Stable 已发布 | 1.1.92-wxcvm.7 | [v1.1.92-wxcvm.7](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.7) | 双端 CI、发行 ZIP 下载及 SHA256 校验通过；已发现 ARTEX 注入问题 |
| Stable 补丁候选 | [1.1.92-wxcvm.8](../package.json) | 尚未创建 | #274 修复 ARTEX 宿主注入；候选 CI、发行与实机复验待完成 |
| Beta | [1.1.92-wxcvm.7-beta.11](https://github.com/wxcvm/dsh-purge/blob/beta/package.json) | 发布资产与标签待独立核验 | beta 源码版本已核对；不整体覆盖 master |

**注意：** Git 标签存在不等于 Release 已发布、资产齐全、校验通过或实机验收完成。.7 的发行任务 [43709689128](https://github.com/wxcvm/dsh-purge/actions/runs/43709689128) 已下载并核验资产；.8 尚未发行。

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
