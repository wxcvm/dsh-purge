<p align="center">
  <img src="docs/banner.svg" alt="PURGE — Private Workspace" width="960">
</p>

<p align="center">
  <strong>个人开发工作台 · DeepSeek Harness 扩展</strong><br>
  <sub>PRIVATE WORKSPACE / WXCVM</sub><br>
  <a href="README.en.md">English</a> &nbsp;·&nbsp; 中文
</p>

<p align="center">
  <a href="docs/RELEASE_CENTER.zh-CN.md">版本中心</a> &nbsp;·&nbsp;
  <a href="docs/DEVELOPMENT_STATUS.zh-CN.md">开发进度</a> &nbsp;·&nbsp;
  <a href="https://github.com/wxcvm/dsh-purge/actions">构建记录</a> &nbsp;·&nbsp;
  <a href="https://github.com/wxcvm/dsh-purge/pulls">开发审查</a> &nbsp;·&nbsp;
  <a href="https://github.com/wxcvm/dsh-purge/issues">问题追踪</a>
</p>

---

## 01 / 工作台

Purge 是面向本机 DeepSeek Harness 的扩展项目，提供宿主状态检查、配置管理、维护与恢复，以及授权安全研究的项目管理界面。本仓库为个人维护版本，代码、开发记录和发布资源通过 GitHub 私有仓库管理。

| 模块 | 定位 |
| --- | --- |
| **清洗台 · Clean** | 宿主状态、配置与规则管理、应用结果和恢复入口 |
| **作战台 · Drill** | 授权测试项目、资产记录、证据与报告管理 |
| **宿主适配 · Host** | Windows Desktop 与 Web 独立环境的兼容性管理 |
| **维护中心 · Maintenance** | 版本信息、构建、诊断、备份与恢复 |

> [!NOTE]
> 当前仓库不再提供匿名公开下载。历史版本的公开链接不代表当前可用的私有安装渠道。请登录获授权的 GitHub 账号访问本仓库与发布资源。

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

**发布原则：** [正式版 `.11`](https://github.com/wxcvm/dsh-purge/releases/tag/v1.1.92-wxcvm.11) 的资产校验与实机验收分开记录，详见[交付台账](docs/DELIVERY_STATUS_11.zh-CN.md)。支持目标以[包元数据](package.json)为准；它不是对 Windows Desktop 或 Web 的实测兼容承诺。

**私有交付：** 下载通过已授权的 GitHub 会话完成；本地安装与更新只使用可信的对应版本包。不要将 GitHub 访问令牌写入 README、配置文件或安装包。旧的匿名下载与自动更新链路仍需单独完成适配。

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

## 04 / 文档中心

| 文档 | 内容 |
| --- | --- |
| [清洗台指南](docs/CLEANING_GUIDE.zh-CN.md) | 界面、状态检查、维护和恢复 |
| [作战台指南](docs/OPERATIONS_GUIDE.zh-CN.md) | 项目记录、证据管理与授权范围 |
| [全部项目文档](docs/) | 现有维护指南、技术说明与历史记录 |

## 05 / 维护约定

- 先定位根因，再提交最小充分修改；避免无意义的重复兼容层。
- Windows 实机验收、自动化测试与发布状态分别记录。
- 宿主升级后重新核对真实运行状态；不把界面成功提示等同于功能有效。
- 仅在自有或明确授权的系统范围内进行安全研究。

## 06 / 许可证与来源

本仓库基于 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 维护。原作者：YuJunZhiXue。保留 [Apache License 2.0](LICENSE)、[NOTICE](NOTICE) 与原作者署名。原作者要求不得转售原始构建、衍生项目必须注明来源。私有仓库可见性不撤销既有开源许可，也不改变已有第三方代码的授权义务。

<p align="center">
  <sub>PURGE / WXCVM · PRIVATE DEVELOPMENT</sub>
</p>
