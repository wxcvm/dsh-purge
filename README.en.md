<p align="center">
  <img src="docs/banner.svg" alt="dsh-purge" width="720">
</p>

<h1 align="center">DeepSeek Harness Security Research &amp; Host Maintenance Extension · dsh-purge</h1>

<p align="center"><em>Clean · Drill · Desktop / Web</em></p>

<p align="center">
  <a href="https://github.com/wxcvm/dsh-purge/releases"><img src="https://img.shields.io/github/v/release/wxcvm/dsh-purge" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a>
  <a href="https://www.deepseek.com/harness/"><img src="https://img.shields.io/badge/DeepSeek-Harness-blue" alt="DeepSeek Harness"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=fff" alt="Node.js">
</p>

<p align="center"><a href="README.md">中文</a> · English</p>

## Contents

- [What this is](#what-this-is)
- [Features](#features)
- [Supported hosts](#supported-hosts)
- [Releases and documentation](#releases-and-documentation)
- [Maintenance and recovery](#maintenance-and-recovery)
- [License and attribution](#license-and-attribution)

---

## What this is

**dsh-purge** is an independent extension for DeepSeek Harness, derived from YuJunZhiXue/dsh-purge and incorporating work from CallMeGuLab/dsh-purge-safe. This WXCVM-maintained branch focuses on local host configuration, compatibility, diagnostics, recovery, and authorized security research project management.

It is not an official DeepSeek plugin and is not affiliated with or endorsed by DeepSeek.

## Features

| Area | Purpose |
| --- | --- |
| **Clean** | Host status, configuration, rules, maintenance and recovery |
| **Drill** | Authorized assessment project records, assets, evidence and reports |
| **Host** | Desktop and Web compatibility management |
| **Maintenance** | Version tracking, diagnostics, backup and recovery |

## Supported hosts

Targets official DeepSeek Harness Desktop and Web environments. See [package.json](package.json) for target versions, Node.js requirements and build scripts. Desktop and Web acceptance is tracked separately; declared targets are not proof of live-host validation.

## Releases and documentation

- [Releases](https://github.com/wxcvm/dsh-purge/releases): stable and preview releases and actual published assets.
- [Release center (中文)](docs/RELEASE_CENTER.zh-CN.md): delivery records and version status.
- [Clean guide (中文)](docs/CLEANING_GUIDE.zh-CN.md): interface, maintenance and recovery.
- [Drill guide (中文)](docs/OPERATIONS_GUIDE.zh-CN.md): project records, evidence and authorization scope.
- [Documentation](docs/) · [Development status (中文)](docs/DEVELOPMENT_STATUS.zh-CN.md) · [Developer entry point](AGENTS.md).

Use the corresponding Release assets for downloads and updates. The source version on the default branch is not itself a published release.

## Maintenance and recovery

After host upgrades or configuration problems, check the actual runtime environment and status before following the maintenance guide for backup or recovery. Automated tests, release asset checks and live-host acceptance are separate verification steps.

Local development checks:

```sh
npm test
npm run build:client
npm run test:all
```

## Scope

For local maintenance, learning and research on owned or explicitly authorized systems only. Unauthorized access, attacks, data acquisition and other unlawful use are prohibited. Users must comply with applicable laws and service terms.

## License and attribution

- Original project: [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) (historical source; the original URL may be unavailable).
- Upstream reference: [CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe).
- Branch maintainer: [WXCVM](https://github.com/wxcvm).

Distributed under [Apache License 2.0](LICENSE). Retain [NOTICE](NOTICE), original attribution and third-party licenses. The original author requests that original builds not be resold and derivatives credit their sources.

---

<p align="center">
  <a href="https://github.com/wxcvm/dsh-purge/issues">Issues</a> · <a href="https://github.com/wxcvm/dsh-purge/pulls">Pull requests</a> · <a href="https://github.com/wxcvm/dsh-purge/actions">Actions</a>
</p>
