---
name: mobile-code-recon
description: 移动应用与代码包静态审查：APK/IPA、Manifest、深链、WebView、网络配置、硬编码端点和敏感信息暴露
whenToUse: 用户提供了自有/授权的 APK、IPA、小程序包或公开代码仓库，需要梳理移动端攻击面时
role: recon
category: 侦察
tags: [mobile, apk, ipa, source-code, privacy]
enabled: true
---

# 移动应用与代码包侦察

只分析用户提供、组织自有或明确授权的应用包与仓库。公开可下载不等于获得测试其后端服务的授权。

## 1. 前置检查

- 记录应用名称、版本、包名、构建渠道、文件来源和 SHA-256。
- 可选工具：`jadx`、`apktool`、`MobSF`、`plutil`。先用 `command -v` 检查是否安装；缺少工具时说明限制，不假装已经分析。
- 静态分析优先；动态验证只使用专用测试设备、测试账号和预发环境。

## 2. Android / iOS 检查项

- Android Manifest：权限、exported 组件、intent-filter、深链、Content Provider、调试和备份标记。
- 网络安全配置：明文流量、信任锚、证书策略和 WebView 的 JavaScript/文件访问设置。
- WebView 与桥接：允许加载的域名、外部 Intent、JavaScript bridge 暴露面和导航校验。
- 本地存储：日志、缓存、偏好设置、数据库和备份中是否出现敏感数据；只记录问题位置，不复制数据内容。
- iOS：Info.plist、URL Scheme、Universal Links、ATS、Keychain 使用方式、调试符号和应用组配置。
- 原生库与依赖：组件名称、版本、许可证、已知安全公告和维护状态。

## 3. API 与代码泄露线索

- 从源码或资源文件提取 API base URL、路径、WebSocket 域名和环境切换配置。
- 对疑似密钥只记录类型、文件路径、行号和脱敏指纹；不尝试登录、不调用管理 API、不把完整值写入报告。
- SourceMap、公开仓库和 CI 配置只分析在授权范围内可访问的内容；个人开发者仓库和第三方 SDK 不自动纳入靶标范围。
- 发现后端域名/IP 时先做归属与范围复核，再决定是否进行任何网络验证。

## 4. 证据与交付

- 使用 `redteam_asset_test` 追加应用包 SHA、版本、组件/配置位置、API 线索和复核状态。
- 只有确认后端资产属于本次范围时，才用 `redteam_asset_add` 登记已确认的 IP；该工具要求真实 IPv4，不要用域名或占位值伪造资产。
- 对可重复的安全缺陷用 `redteam_vuln_add` 记录；证据只保留必要的脱敏片段。
- 输出按“确认问题 / 风险线索 / 未验证项”分组，并列出修复建议。

不破解付费应用、不绕过账号付费限制、不提取或使用真实凭据、不批量请求生产 API，也不对未授权后端发起探测。
