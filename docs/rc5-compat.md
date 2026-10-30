# DSH 0.2.1-rc.5 适配记录

宿主：`@deepseek-ai/dsh-desktop 0.2.1-rc.5`，桌面端把宿主整包封在 `D:\dsh\resources\app.asar`（182 MB）里，
`resources\app` 不存在，所以插件点「应用」前 `purge_status` 显示 `0/0 applied` + `app.asar: 还在`。

## 怎么验的（不碰现场安装）

```bash
# 1) 把 asar 解到一个临时目录（纯读，不动原包）
node extract.mjs            # extractAsar('D:/dsh/resources/app.asar', 'D:/deepseek/_host-rc5/app')
# 2) 拿 aiBase = <tmp>/app/dsh/node_modules/@deepseek-ai 做补丁状态探测
node probe-status.mjs       # core.patchStatus(aiBase)
# 3) 在临时树上真跑一遍应用，再看语法
node apply-probe.mjs        # core.applyPatches(aiBase) + 逐文件 node --check
```

## 结果

| 指标 | rc.5 临时树 |
|---|---|
| 补丁总数 | 82 |
| `applyPatches` 直接改写 | **60 applied**（另 6 already / 5 na / 7 missing_file / 4 skipped） |
| 应用后 `patchStatus` | **66 applied**、11 na、4 skipped、1 missing_file |
| 被改写文件 | 47 |
| `node --check` | **0 失败** |

与 rc.2 时期完全一致的 5 条未命中（不是 rc.5 回归）：

- `#32 WEB_SURFACE_IDENTITY_NEUTRAL`、`#53 WEB_SURFACE_PROHIBITION` —— web 面专属，桌面端没有对应文件
- `#80 MINIMAL_OFFICIAL_TOOLSET` —— minimal 工具集未安装
- `#77 REWIND_DROP_SENT_ON_APPEND` —— 目标文件不在本宿主
- `#71 LIANGSHEN_IDENTITY_LINE` —— 梁神预设未安装

## 桌面壳（`app/lib/main.js`，513 KB）

`officialShellMain()` 走真实安装路径，密封态下解不出文件，所以用解包后的 `lib/main.js` 单独验模式：

| 补丁 | rc.5 命中 |
|---|---|
| `#45 OFFICIAL_DESKTOP_UPDATE_HANDOFF` | 2/2 |
| `#82 DESKTOP_SHELL_PROFILE_FALLBACK` | 1/1 |
| `#83 DESKTOP_HOST_CLOSE_NO_FATAL` | 1/1（rc.5 的 close 处理器签名从 `(code)` 变 `(code, signal)`，模式已覆盖） |
| `#84 DESKTOP_HOST_CLOSE_CODE0_NO_FAIL` | 依赖 #83 输出，串行应用后 1/1 |
| `#46 OFFICIAL_DESKTOP_UPDATE_ASCII` | 官方换包脚本那段（`__EXE_JSON__` / `templatePath`）在 rc.5 已被上游重写，只剩无害空转 |

## 生效步骤

1. 插件面板点「应用」→ 自动 `extractAsar` 到 `D:\dsh\resources\app` 并重启桌面端；
2. 重启后 `purge_status` 应为 60+/66 applied；
3. 回滚：面板「还原」走 `.dshpurge.bak`，或删掉 `resources\app` 让宿主回落到 `app.asar`。
