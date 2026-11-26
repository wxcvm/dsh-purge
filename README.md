<p align="center">
  <img src="docs/banner.svg" alt="dsh-purge" width="720">
</p>

<h1 align="center">DeepSeek Harness 安全研究与宿主维护插件 · dsh-purge</h1>

<p align="center">
  <em>Clean · Drill · Desktop / Web</em>
</p>

<p align="center">
  <a href="https://github.com/wxcvm/dsh-purge/releases"><img src="https://img.shields.io/github/v/release/wxcvm/dsh-purge" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a>
  <a href="https://www.deepseek.com/harness/"><img src="https://img.shields.io/badge/DeepSeek-Harness-blue" alt="DeepSeek Harness"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=fff" alt="Node.js">
</p>

<p align="center">
  中文 · <a href="README.en.md">English</a>
</p>

## 目录

- [项目介绍](#项目介绍)
- [功能概览](#功能概览)
- [支持的宿主](#支持的宿主)
- [版本与文档](#版本与文档)
- [维护与恢复](#维护与恢复)
- [许可证与署名](#许可证与署名)

---

## 项目介绍

**dsh-purge** 是面向 DeepSeek Harness 的独立扩展项目，源自 YuJunZhiXue/dsh-purge，并持续参考 CallMeGuLab/dsh-purge-safe 的上游工作。本分支由 WXCVM 维护，聚焦本地宿主配置、兼容性、诊断、恢复和授权安全研究的项目管理。

本项目并非 DeepSeek 官方插件，与 DeepSeek 无隶属或背书关系。

## 功能概览

| 模块 | 功能定位 |
| --- | --- |
| **Clean · 清洗台** | 宿主状态、配置与规则管理、维护和恢复 |
| **Drill · 作战台** | 授权测试项目、资产记录、证据与报告管理 |
| **Host · 宿主适配** | Desktop 与 Web 环境的兼容性管理 |
| **Maintenance · 维护中心** | 版本、诊断、备份与恢复 |

## 支持的宿主

面向官方 DeepSeek Harness Desktop 与 Web 环境。具体目标版本、Node.js 要求及构建脚本见 [package.json](package.json)。Desktop 和 Web 的支持状态及实机验收分别记录；声明的目标版本不等于已经通过实机验收。

## 版本与文档

- [Releases](https://github.com/wxcvm/dsh-purge/releases)：正式版、预览版及实际发布资产。
- [版本中心](docs/RELEASE_CENTER.zh-CN.md)：版本状态与交付记录。
- [清洗台指南](docs/CLEANING_GUIDE.zh-CN.md)：界面、维护与恢复。
- [作战台指南](docs/OPERATIONS_GUIDE.zh-CN.md)：项目记录、证据管理及授权范围。
- [全部文档](docs/) · [开发进度](docs/DEVELOPMENT_STATUS.zh-CN.md) · [开发者入口](AGENTS.md)。

下载与更新以对应 Release 的实际资产为准；主线源码版本并不等同于已发布版本。

## 维护与恢复

宿主升级或配置异常时，先检查实际运行环境与状态，再根据维护指南执行备份或恢复。自动化测试、发布资产校验与实机验收应分别核对。

本地开发检查：

```sh
npm test
npm run build:client
npm run test:all
```

## 使用范围

仅用于本机维护、学习以及自有或明确授权环境中的安全研究。不得用于未经授权的访问、攻击、数据获取或其他违法用途。使用者应遵守适用法律与服务条款。

## 许可证与署名

- 原始项目：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（历史来源，原链接可能不可访问）。
- 参考上游：[CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe)。
- 本分支维护：[WXCVM](https://github.com/wxcvm)。

本项目沿用 [Apache License 2.0](LICENSE)。原始代码及上游代码保留各自版权，WXCVM 对其自行创作的修改与新增内容保留版权；其他贡献者保留各自版权。再分发时应遵守许可证并保留适用的 [NOTICE](NOTICE)、署名及第三方许可。原作者提出不转售原始构建的请求；该请求不改变 Apache-2.0 正文所授予的权利。

---

<p align="center">
  <a href="https://github.com/wxcvm/dsh-purge/issues">Issues</a> · <a href="https://github.com/wxcvm/dsh-purge/pulls">Pull requests</a> · <a href="https://github.com/wxcvm/dsh-purge/actions">Actions</a>
</p>
