<p align="center">
  <img src="docs/banner.svg" alt="PURGE — Personal Workspace" width="960">
</p>

<p align="center">
  <strong>个人开发工作台 · DeepSeek Harness 扩展</strong><br>
  <sub>PERSONAL WORKSPACE / WXCVM</sub><br>
  <a href="README.en.md">English</a> &nbsp;·&nbsp; 中文
</p>

<p align="center">
  <a href="docs/RELEASE_CENTER.zh-CN.md">版本中心</a> &nbsp;·&nbsp;
  <a href="docs/DEVELOPMENT_STATUS.zh-CN.md">开发进度</a> &nbsp;·&nbsp;
  <a href="docs/CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md">Codex 上游吸收总方案</a> &nbsp;·&nbsp;
  <a href="https://github.com/wxcvm/dsh-purge/actions">构建记录</a> &nbsp;·&nbsp;
  <a href="https://github.com/wxcvm/dsh-purge/pulls">开发审查</a> &nbsp;·&nbsp;
  <a href="https://github.com/wxcvm/dsh-purge/issues">问题追踪</a>
</p>

---

## 01 / 工作台

Purge 是面向本机 DeepSeek Harness 的扩展项目，提供宿主状态检查、配置管理、维护与恢复，以及授权安全研究的项目管理界面。本仓库为个人维护的公开版本；代码、开发记录及发布资产分别在 GitHub 的代码页、Issues/PR 和 Releases 查看。

| 模块 | 定位 |
| --- | --- |
| **清洗台 · Clean** | 宿主状态、配置与规则管理、应用结果和恢复入口 |
| **作战台 · Drill** | 授权测试项目、资产记录、证据与报告管理 |
| **宿主适配 · Host** | Windows Desktop 与 Web 独立环境的兼容性管理 |
| **维护中心 · Maintenance** | 版本信息、构建、诊断、备份与恢复 |

> [!NOTE]
> 以对应 Release 实际列出的资产为准。主线版本号、分支源码与已发布包不能互相代替；下载后先核对校验文件。

## 02 / 版本与交付

> [**版本中心**](docs/RELEASE_CENTER.zh-CN.md) · Stable / Beta 快照、发布阶段、资产核对与实机验收记录。
>
> [**开发进度**](docs/DEVELOPMENT_STATUS.zh-CN.md) · 已合并工作、待处理事项与优先级。

| 入口 | 用途 |
| --- | --- |
| [Releases](https://github.com/wxcvm/dsh-purge/releases) | 查看已发布版本及可用安装包 |
| [package.json](package.json) | 当前源码版本、运行环境与构建脚本 |
| [Actions](https://github.com/wxcvm/dsh-purge/actions) | 查看 CI、构建结果及产物 |
| [提交历史](https://github.com/wxcvm/dsh-purge/commits/master/) | 追踪变更与回归来源 |

**发布状态（2026-11-21 核对）：** 最新正式版为 [.18](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.18)，最新已发布预览版为 [.7-beta.11](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.7-beta.11)。主线后续合并不属于已发布的 .18。较早 [`.11`](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.11) 的资产与实机验收另见[历史交付台账](docs/DELIVERY_STATUS_11.zh-CN.md)，不能移用到 .18。当前详情见[版本中心](docs/RELEASE_CENTER.zh-CN.md)；支持目标以[包元数据](package.json)为准，不等于 Windows Desktop 或 Web 已通过实机兼容验收。

**安装与更新：** 公开资产校验不替代实机验收。私有部署需使用具有访问权限的 GitHub 会话，授权下载与恢复路径单独验证；不要将访问令牌写入文档或安装包。

## Codex / DSH 任务交接

直接从 [`AGENTS.md`](AGENTS.md) 开始，阅读 [接手版上游吸收的完整计划、原始源码与验收清单](docs/CODEX_UPSTREAM_ADOPTION_PLAN.zh-CN.md)。相关进度仍写在已有的 [#347 上游追踪](https://github.com/wxcvm/dsh-purge/issues/347) 与 [#351 全项目总台账](https://github.com/wxcvm/dsh-purge/issues/351)，无需创建重复总台账。文档状态、PR/CI、真实 Desktop 验收和 Release 必须分别核查。

## 03 / 开发导航

| 目录 / 文件 | 职责 |
| --- | --- |
| [`client.js`](client.js) | 宿主客户端界面与工作区 |
| [`lib/`](lib/) | 运行时模块、宿主适配与核心逻辑 |
| [`bin/`](bin/) | 命令行入口 |
| [`scripts/`](scripts/) | 构建、安装辅助与维护脚本 |
| [`test/`](test/) | 自动化测试 |
| [`docs/`](docs/) | 使用指南与技术记录 |

### 本地开发检查

```sh
npm test
npm run build:client
npm run test:all
```

运行环境与具体脚本以 [package.json](package.json) 为准；Windows Desktop 和 Web 的配置、运行实例与验收结果应分别核对。

**Harness 0.2.3-alpha.2 运行环境：** 官方因内置 undici 的安全修复提高了 Node.js 要求至 `^24.22.3 || >=26.13.1`，适用于 npm 安装、源码开发及显式使用 Node 的 Python SDK。官方打包的 Desktop 自带 Node.js 24.22.3，无需仅因此升级系统 Node.js。此说明仅描述宿主运行环境；Purge 对 alpha.2 尚未声明支持，不能据此推断兼容或实机验收通过。详见[官方升级指南](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/upgrade-guide/v0.2.3-alpha.1/node-24-22-3/guide.zh.md)。

## 04 / 文档中心

| 文档 | 内容 |
| --- | --- |
| [清洗台指南](docs/CLEANING_GUIDE.zh-CN.md) | 界面、状态检查、维护和恢复 |
| [作战台指南](docs/OPERATIONS_GUIDE.zh-CN.md) | 项目记录、证据管理与授权范围 |
| [真实任务质量验收](docs/CLEAN_EFFECT_VALIDATION.zh-CN.md) | 三组对照、零调用预检、离线评分与断点续测 |
| [全部项目文档](docs/) | 现有维护指南、技术说明与历史记录 |

## 05 / 维护约定

- 先定位根因，再提交最小充分修改；避免无意义的重复兼容层。
- Windows 实机验收、自动化测试与发布状态分别记录。
- 宿主升级后重新核对真实运行状态；不把界面成功提示等同于功能有效。
- 仅在自有或明确授权的系统范围内进行安全研究。

## 06 / 许可证与来源

本仓库沿用 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 的历史来源与署名（该原始 GitHub URL 于 2026-11-20 查询返回 404，可能已私有、迁移或下架，并非仍可直接获取源码的保证）。原作者署名：YuJunZhiXue。保留 [Apache License 2.0](LICENSE)、[NOTICE](NOTICE) 与原作者署名。原作者要求不得转售原始构建、衍生项目必须注明来源。仓库可见性变化不撤销既有开源许可，也不改变已有第三方代码的授权义务。

<p align="center">
  <sub>PURGE / WXCVM · PROJECT MAINTENANCE</sub>
</p>
