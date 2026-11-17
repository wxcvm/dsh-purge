# PURGE / 版本中心

[返回工作台](../README.md) · [Releases](https://github.com/wxcvm/dsh-purge/releases) · [Actions](https://github.com/wxcvm/dsh-purge/actions) · [开发进度](DEVELOPMENT_STATUS.zh-CN.md)

> 本页为私有仓库的维护快照，不是自动更新接口。实际可下载版本、文件及校验值以对应 Release 为准。

## 当前版本快照 · 2026-11-17

| 渠道 | 源码版本 | Git 标签 | 状态 |
| --- | --- | --- | --- |
| Stable 历史标签 | 1.1.92-wxcvm.6 | [v1.1.92-wxcvm.6](https://github.com/wxcvm/dsh-purge/tree/v1.1.92-wxcvm.6) | 保留旧标签 |
| Stable 已发布 | 1.1.92-wxcvm.7 | [v1.1.92-wxcvm.7](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.7) | Release 资产与 SHA256 已核验 |
| Stable 已发布 | 1.1.92-wxcvm.8 | [v1.1.92-wxcvm.8](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.8) | Release 资产与 SHA256 已核验；真实 Desktop 验收仍需单独记录 |
| Stable 发版前候选 | [1.1.92-wxcvm.9](../package.json) | 尚未创建 | 富江 #318–#321、长对话 #317 等已合并，相关 Windows + Ubuntu PR CI 通过；最终 master 联合验收、Release dry-run 及 Desktop 实机验收仍待独立确认 |
| Beta | [1.1.92-wxcvm.7-beta.11](https://github.com/wxcvm/dsh-purge/blob/beta/package.json) | 资产与标签状态待独立核验 | 不整体覆盖 master，也不自动提升为 Stable |

**版本边界：** .8 标签指向提交 `9704f745`，保持不可变；当前 .9 候选基于其后的 master 改进，使用新版本号，不移动或覆盖历史标签。PR #277 记录了 .8 Release 发布成功、ZIP 下载及 SHA256 核验。

**验收边界：** 早期 #278–#281、#283–#290、#296–#297、#282、#295，以及最近的 #317、#318、#319、#320、#321 均已合并。#317、#319–#321 的对应双平台 PR CI 已确认成功，其他更早批次验收记录保留在各 PR；**PR CI 不能替代最终 master 的整体验收**。当前 .9 仍未发布，Release 预演、可下载产物和真实 Windows Desktop 安装/升级/运行验收分别待确认。

## .9 发版前冻结与预演

- **范围冻结**：目前以 master 已合并的富江、长对话及运行时修复为基线，先处理验收暴露的缺陷，不再为 .9 加入无关的大功能；当前候选版本仍为 `1.1.92-wxcvm.9`。
- **统一 CI**：以最终集成的 master 提交为准核对 Windows + Ubuntu `Local Compatibility (Windows + WSL)` 工作流、客户端生成包和必要测试；PR 绿色只证明对应 PR 提交通过。
- **发布包预演（不会发版）**：在仓库 Actions → **Release** → **Run workflow** 中选择 `master`，勾选 `dry_run: true`。此工作流检查发布说明版本、打包 ZIP 的版本与关键文件，并在 Runner 中生成 `SHA256SUMS.txt`，然后退出，不创建标签、不发布 Release、不上传正式资产。当前工作流未上传 dry-run ZIP 为可下载 artifact，因此日志中的成功不等于外部已核验可下载资产。
- **Windows Desktop 实机**：安装候选、启动、重启、切换页面、工具调用与知识搜索/打开、ARTEX 联动、授权更新及回退各自记录宿主版本、运行结果和失败日志。无实机记录时状态保持待验证。
- **发行前停止点**：本阶段不运行 `dry_run: false`、不创建 `v1.1.92-wxcvm.9` 标签、不上传正式 Release 资产。通过最终验收后，再单独进行正式发布决策；若 master 出现新提交，应复核本次验收是否仍覆盖最新源码。

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
