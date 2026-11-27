# PURGE / 开发进度

[返回工作台](../README.md) · [版本中心](RELEASE_CENTER.zh-CN.md) · [PR 列表](https://github.com/wxcvm/dsh-purge/pulls) · [问题追踪](https://github.com/wxcvm/dsh-purge/issues)

## 当前对账 · 2026-11-24（第二次核对）

- 接手维护参考 [CallMeGuLab/dsh-purge-safe main@29bf73a](https://github.com/CallMeGuLab/dsh-purge-safe/commit/29bf73a962891cc2c543077572ebd70078897d69) 暂无新提交；[原版镜像](https://github.com/mmparko/dsh-purge/commit/033e6bd1e0f101352b39075ecd0d758ffef26b76) 仍为 033e6bd，历史来源 YuJunZhiXue/dsh-purge 本次 API 返回 404（无法确认其状态）。
- 本次核对主线 [18a8ea4](https://github.com/wxcvm/dsh-purge/commit/18a8ea421f9f6c9a06ace999e6e05fe9c6e4271f)。普通维护 #520–#528、主题 #529 与只读上游来源观察 #530 已合并，各自 PR CI 通过；#531 重启弹窗全屏及短视口适配仍在 PR 验收，不能算作已合并。
- 选择性吸收记录：[#529](https://github.com/wxcvm/dsh-purge/pull/529) 吸收上游布尔主题属性值判定，保留现有颜色方案解析；[#530](https://github.com/wxcvm/dsh-purge/pull/530) 补齐接手版只读状态查询。Git 历史祖先关系只能说明提交是否包含在本地历史中，不能证明选择性移植的功能缺失或齐全；以具体源码、测试与 [#347](https://github.com/wxcvm/dsh-purge/issues/347) 的逐项记录为准。
- 正式发行版仍为 .24；当前主线未作为新资产发布。最终主线自托管 CI 与实际 Windows Desktop / Web 安装、绘制、重启验收分别记录，不以 PR 通过替代。

## 历史对账 · 2026-11-24（第一次核对）

- 最新正式版为 [v1.1.92-wxcvm.24](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.24)，标签 `1932650`；Release 工作流通过，同 SHA 主线 Windows/Ubuntu 兼容性工作流取消，未计作通过。资产元数据、验收边界见[版本中心](RELEASE_CENTER.zh-CN.md)。
- 本次核对的 master 为 [b053a55](https://github.com/wxcvm/dsh-purge/commit/b053a5507cca355b2bdf4900f1f37f7da6d59131)，#520 已合并但不在 .24 标签中。仓库当前公开。
- 配置持久化和窗口绘制分别继续按 [#361](https://github.com/wxcvm/dsh-purge/issues/361) 和 [#364](https://github.com/wxcvm/dsh-purge/issues/364) 追踪实机验收；CI 资源预算按 [#348](https://github.com/wxcvm/dsh-purge/issues/348) 追踪。

## 历史对账 · 2026-11-21

- 主线 `748192d` 的 [Windows / Ubuntu CI](https://github.com/wxcvm/dsh-purge/actions/runs/44901063903) 通过；[合并 PR #429](https://github.com/wxcvm/dsh-purge/pull/429) 已统一通用/局部提示词工作区，加入模型范围操作和独立 Super Agent 页面，不再重复合并旧 PR。
- 最新正式版 .18 与最新预览版 .7-beta.11 均已按下载资产、校验清单、标签提交和包内关键文件核对；不把后续主线功能或验收归到该资产。详见[版本中心](RELEASE_CENTER.zh-CN.md)。本次查验时仓库为公开；下方私有迁移属于旧快照。
- 当前 0–8 项及尚待验收的真实安装、Provider、窗口和 ARTEX 双端，见[本轮对账](CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md#8--版本中心发布证据与远期研究)与 [#351 总台账](https://github.com/wxcvm/dsh-purge/issues/351)。

> 下文为 2026-11-12 历史记录，不用于判断当前可见性、最新版本或实机完成状态。

## 已完成 · 仓库与维护

| 工作 | 依据 |
| --- | --- |
| 仓库转为 Private | [仓库设置](https://github.com/wxcvm/dsh-purge/settings) |
| 私人工作台首页、中英文导航与品牌横幅 | [#178](https://github.com/wxcvm/dsh-purge/pull/178)，已合并 master |
| 更新事务、异常恢复与重启验证相关改动 | [#175](https://github.com/wxcvm/dsh-purge/pull/175)，已合并 beta |
| Beta.3 发布候选准备 | [#176](https://github.com/wxcvm/dsh-purge/pull/176)，已合并 beta |
| Beta.3 集成验证分支 | [#177](https://github.com/wxcvm/dsh-purge/pull/177)，已合并候选分支 |

合并状态仅表明对应代码已进入目标分支，不表示最新 CI、发布资产、所有运行环境或真实安装结果已经验收。

## 待处理 · 私有迁移与版本管理

| 优先级 | 事项 | 验收标准 |
| --- | --- | --- |
| P0 | 私有发布路径核对 | 对应版本的 Release 资产可访问，版本及校验匹配；避免公开下载路径误导 |
| P0 | 私有安装与更新兼容 | 通过授权获取正确包；安装、更新与版本切换分别验证；凭据不进入仓库或日志 |
| P0 | Windows Desktop 实机验收 | 记录安装版本、宿主版本、重启后的真实运行结果 |
| P1 | Web 实机验收 | 独立记录 Web 的版本和运行结果 |
| P1 | Beta → Stable | [#171](https://github.com/wxcvm/dsh-purge/pull/171) 已关闭未合并（历史参考）；不将其当作当前待合并任务 |
| P1 | 首页以外的 GitHub 外观 | About、Topics、社交封面尚未调整 |

## 工作流

1. 从目标分支创建独立分支，记录问题、改动范围与验收标准。
2. 在 PR 中明确目标分支、版本影响、测试结果与待验证项。
3. 合并后确认目标分支，必要时独立进行构建、发布和真实宿主验收。
4. 更新 [版本中心](RELEASE_CENTER.zh-CN.md) 与本页的日期和对应记录。

本次维护仅改变文档与仓库导航，不修改更新器、运行时、CI 或发布配置，不提升 Beta，也不发布新版本。
