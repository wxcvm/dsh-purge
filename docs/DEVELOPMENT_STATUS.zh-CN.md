# PURGE / 开发进度

[返回工作台](../README.md) · [版本中心](RELEASE_CENTER.zh-CN.md) · [PR 列表](https://github.com/wxcvm/dsh-purge/pulls) · [问题追踪](https://github.com/wxcvm/dsh-purge/issues)

## 当前对账 · 2026-11-21

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
