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

## 环境适配页面自动识别 FlClash（Windows）

Purge 的「环境适配 → 网络配置」现在直接提供
**检测 FlClash 本地代理**、模式 B 的 VPS1/VPS2 VLESS + REALITY
配置与 **验证插件 VPS2 出口** 按钮。无需打开独立控制台，
也不必使用命令行进行本次出口验证。

自动发现只读取 Windows 用户的
`%APPDATA%\\com.follow\\clash\\config.yaml`，兼容性候选位置
`%APPDATA%\\com.follow\\flclash\\config.yaml`。
只提取顶层 `mixed-port`、`socks-port`、`port`，优先混合端口，
只对这些**明确配置**的端口进行短暂的 `127.0.0.1` TCP
连接与 SOCKS5/HTTP 协议握手（HTTP CONNECT 的测试目标也仅为
`127.0.0.1:1`），不会向外部网站发起验证请求；不会扫描其它端口、读取或上传机场订阅、
导出配置中的代理账号、访问互联网或操作系统 TUN/路由。

- 发现端口且本机监听可连接：显示通过本地协议握手的 HTTP/SOCKS5
  候选端点，**不表示 FlClash 进程身份或机场实际出口已经验证**。
  用户必须再次点击「确认入口并保存模式 B」才能写入 Purge。
- 如果 FlClash 只开启 TUN、监听端口被禁用或内核未运行：
  显示不可用；**不猜测 7890**，也不以 TUN 自动代替代理端口。
- 如果本地入口需要代理认证：只标记认证要求，不提取账号或密码，
  此版本不会自动启用该入口。
- Windows 上运行的 Purge 才能读取 Windows 的 FlClash 配置；
  若 Purge 运行在 WSL/Linux/Android 容器里，不会将容器内
  `127.0.0.1` 错当 Windows 回环地址，需要另外明确配置可达入口。

保存模式 B 使用现有私有 `proxy-pool.json`、活动节点以及
`strictEgress` 约束。VPS 的 SSH 管理信息与 VLESS+REALITY
中转凭据是不同连接用途，不能仅凭 VPS SSH 地址推断代理 UUID。
本页的出口验证要求真实 **三跳**、严格出口开启，并由用户手填
预期 VPS2 公网 IPv4。命令行脚本保留给高级故障排查，不再是必选步骤。

## 导出给 ARTEX Docker 使用（本机显式下载）

在「环境适配 → 网络配置」保存并启用 Purge 严格模式 B 后，可点击
**导出 ARTEX Docker 配置（包含凭据）**。导出只读取当前活动的 2/3 跳
Mode B 节点，生成 ARTEX 的 `network/mode-b/config.yaml` 格式；
本机 FlClash 的 `127.0.0.1` / `localhost` 入口会改写为
`host.docker.internal`，VPS1/VPS2 的拨号链、最终 MATCH 路由与
DNS 最终节点保持一致。不会启动 ARTEX、启动 Purge Mihomo、修改
Windows 路由、系统代理或 TUN，也不会将凭据上传到外部服务。

下载后将文件放到 ARTEX 仓库的 `network/mode-b/` 目录并命名为
`config.yaml`。该文件包含机场入口和 VPS 代理凭据，必须留在本机私密
目录，**不要提交 Git、上传工单或粘贴到聊天中**。

**Docker 入口要求：** ARTEX 的网关容器通过 `host.docker.internal`
连接本机 FlClash 监听端口。Purge 的本地检测只证明回环端口在本机可连，
不证明 Docker host-gateway 可达。如果 FlClash 只绑定
`127.0.0.1`，容器通常无法连接；需要让监听器接受 Docker host-gateway
流量，并用 Windows 防火墙将来源限制到 Docker 网关/执行网络，不能简单
向整个局域网开放代理端口。ARTEX 的网关端口不应发布到宿主机。

此配置仅用于 ARTEX Linux Docker tool-executor 中显式使用代理的请求；
不覆盖模型 API、外部 MCP、浏览器、Windows 原生程序或系统 TUN。
ARTEX 仍需单独启动 Mode B Compose，并在 ARTEX 隐私页完成一次出口验证。
无须为此开启 Windows TUN，也无须重新填写机场订阅；但首次下载后需要
将文件放入 ARTEX 配置目录。

## Purge 模式 B 出口验收（操作者显式执行）

完成模式 B 三跳节点配置后，可以从 **Purge 运行环境相同的主机与
同一个 `DSH_HOME`** 中主动运行一次出口检查：

```sh
node scripts/mode-b-verify.mjs --expected-exit-ip "$EXPECTED_VPS2_IP"
```

其中 `EXPECTED_VPS2_IP` 需要事先填写为你真实的 VPS2 公网 IPv4。
Windows PowerShell 可用 `$env:EXPECTED_VPS2_IP` 作为参数；
如果脚本与宿主使用不同 `DSH_HOME`，指定
`--root "<DSH_HOME>/redteam"`。默认读取当前环境的
`$DSH_HOME/redteam/proxy-pool.json`，不更改节点或系统代理。

脚本首先要求活动节点是 **已启用的三跳 Mode B** 且
`strictEgress=true`；否则在**发出任何网络请求之前**拒绝。
符合要求时，通过现有 `requestWithProxyPool`，以
`requireProxy: true` 只向 `https://api4.ipify.org/` 发送
一次明确的 HTTPS 请求，将返回的公网 IPv4 与预期 VPS2 地址比较。
节点关闭、上游断开、出口不匹配或不可验证均返回失败，
不会在脚本内建立直连后备。成功只报告匹配、不回显实际出口 IP。

**通过 ≠ 已证明中间跳：** 该检查只能证明被 Purge 代理池管理的
这一次请求使用了与预期相同的出口地址。机场、VPS1、VPS2 逐跳身份、
DNS/IPv6、模型 API、外部 MCP、Windows TUN、宿主机防泄露策略
仍需独立观察和断链验收。切勿将结果复制为“全局 IP 防泄露已验证”。

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
