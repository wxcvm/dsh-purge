# 代理池控制台（独立页面）

插件自带的 client.js 里没有代理设置入口（本地那份是精简打包产物），所以单独做了一个页面，
不侵入打包产物、不需要重新构建。

## 打开

```
D:\deepseek\tools\..\  →  直接双击
C:\Users\Kerna\.dsh\plugins\dsh-purge\maintenance\proxy-console.html
```

浏览器打开后：

1. 端口填当前 DSH 的 GUI 端口（地址栏 `http://127.0.0.1:53380` 里的 53380）
2. 点「连接」

也可以带参数直接进：`proxy-console.html?port=53380`

## 能做什么

| 区块 | 操作 |
|---|---|
| 池状态 | 启用/停用池、开启/关闭严格出口、测试全部节点、全部断开 |
| 节点 | 连接 / 测试 / 删除单个节点 |
| 添加节点 | 名称、协议（socks5/intro）、主机、端口、账号密码、noProxy |
| YAML 导入 | 粘贴 mihomo 风格订阅，导入到池；或作为单代理配置解析 |

底层全部走 `POST /redteam/api` 的 proxy* op：`proxyPoolGet / proxyPoolSave / proxyProfileSave /
proxyProfileDelete / proxyProfileConnect / proxyProfileTest / proxyPoolTest / proxyPoolDisconnect /
proxyPoolImport / proxyConfigImport`。

## 为什么 file:// 能调

`lib/redteam/ui.js` 的 HTTP 桥对回环来源放行：`origin === 'null'`（file:// 页面）或空 Origin 在
`Host` 是 `127.0.0.1`/`localhost` 时直接通过。实测：

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:53380/redteam/api' -Method Post `
  -Headers @{ Origin = 'null' } -ContentType 'application/json' -Body '{"op":"proxyPoolGet"}'
# → ok=True enabled=False
```

## 模式 B 多跳 · 插件出站（可选）

现有本地代理控制台新增「模式 B · 机场 → VPS1 → VPS2」输入框。
输入一个按顺序排列的 JSON 节点数组（2 个是机场 → VPS1，
3 个才是机场 → VPS1 → VPS2），使用原有代理池的
`proxyProfileSave` / `proxyPoolSave` 保存，不修改 SSH 管理跳板或
Windows TUN。具体示例：

```json
[
  { "type": "socks5", "server": "127.0.0.1", "port": 7890 },
  { "type": "vless", "server": "192.0.2.10", "port": 443,
    "uuid": "REPLACE_WITH_VPS1_UUID", "tls": true,
    "servername": "REPLACE_WITH_REALITY_SNI",
    "reality-opts": { "public-key": "REPLACE_WITH_PUBLIC_KEY", "short-id": "REPLACE_WITH_SHORT_ID" } },
  { "type": "vless", "server": "198.51.100.20", "port": 443,
    "uuid": "REPLACE_WITH_VPS2_UUID", "tls": true,
    "servername": "REPLACE_WITH_VPS2_SNI",
    "reality-opts": { "public-key": "REPLACE_WITH_VPS2_KEY", "short-id": "REPLACE_WITH_SHORT_ID" } }
]
```

**全部示例地址和密钥均须替换**；上面的 TEST-NET 地址不是真实出口。
机场节点必须是本机可达的 SOCKS5/HTTP 代理，远端节点使用 IPv4/IPv6
字面量，避免未验证的远端主机名解析路径。中间和最终节点允许
VLESS、VMess、Shadowsocks、Trojan TCP 型代理，暂不接受 HY2/UDP
型中间转发。原有 VPS1 的 HY2/VLESS 服务不被修改，是否能经机场
正确转发 VPS1 的 VLESS+REALITY 仍须实际检测。

Mihomo 子进程只绑定随机的 `127.0.0.1` 监听地址，
通过 `dialer-proxy` 强制指定每个节点由前一跳拨号：
`vps2 → vps1 → airport-entry`，唯一 `MATCH` 路由使用链尾节点，
不会自动选择 `DIRECT`。解析目标域名的 DNS-over-HTTPS 也显式
选择最终节点，没有外部 provider、代理组自动切换或本机 TUN。
保存并选择链式节点时，自动启用已实现的 `strictEgress`；
链式节点失败，代理池不能自动切换到其他非链式节点。

本机配置和 UUID 等敏感字段写入已有私有 `proxy-pool.json`，
对 API 和界面仅返回跳数、配置阶段、非敏感的节点元数据；
状态固定 `verification: not_tested`，**成功启动 Mihomo 或能访问
api.github.com，都不等于已验证三个中转节点或最终 IP**。

这只是 Purge 插件代理池的显式 HTTP(S) 出口。**Harness 模型 API、
系统 DNS、外部 MCP、浏览器、ARTEX 的任务流量都不在本功能覆盖范围。**
进程运行在宿主机上，不具备 ARTEX Docker 的隔离网络。
对于严格防直连要求，仍需要进程/容器级网络隔离和逐跳断链验收。
关于 `dialer-proxy` 和 Reality 作为中转节点的兼容性警告：
https://wiki.metacubex.one/en/config/proxies/dialer-proxy/ 。

## 严格出口（可选）

在本地控制台的「池状态」点击「严格出口：开启」，这会把
`proxy-pool.json` 中的 `strictEgress` 设为 `true`（默认关闭）。
即使之后停用代理池、没有活动节点、节点故障或目标命中
`noProxy`，通过 `requestWithProxyPool` 发起的插件 HTTP(S)
请求也会失败，而不是直连。手动关闭严格出口后恢复旧的
`noProxy` 与停池直连行为。

这个策略**不是系统级断网开关**，只覆盖由本插件代理池管理的
GitHub 查询等显式 HTTP 请求。不覆盖 Harness 模型 API、
外部 MCP、ARTEX 任务、Windows 原生程序、DNS 或浏览器。
此外，Purge 自带的 Mihomo 单节点适配器不会装配
`dialer-proxy` 多跳链；要使用机场 → VPS1 → VPS2 必须
先建立并独立验收真正的多跳网关，再将其本地代理端点作为
代理池节点连接。配置入口与本机 SSH 管理路径相互独立。

## 边界

页面只改插件自己的池状态（`$DSH_HOME/redteam/proxy-pool.json`、`proxy.json`），
不动系统代理、浏览器代理、模型 API 的代理。池真正被使用的场景只有两处：
插件的 GitHub 版本查询（`fetchJsonFromGithub`）和显式调用的节点测试。
