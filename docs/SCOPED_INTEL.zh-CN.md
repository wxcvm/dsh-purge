# 外部被动资产情报（第一阶段）

资源 → 测绘中心 → 外部被动情报 · 单 IP。

1. 在当前项目登记自有或获授权的 IP/CIDR 范围。
2. 输入单个 IP，勾选同意将 IP 发送给所选平台，默认免费 InternetDB。
3. 可选 Shodan REST，需在服务端进程环境设置 SHODAN_API_KEY（不通过客户端传输）。
4. 默认仅预览；选择导入才写入现有 SQLite 资产库。所有历史线索（包括未提供传输协议的 InternetDB 端口）作为被动观察保存，不写入实时端口表或漏洞表，也不覆盖已有资产状态。重复的同源结果只刷新采集时间。历史第三方记录不是实时确认或漏洞证据。
5. 点击「读取本地情报历史」可按 IP 离线查看最近 100 条记录，无需 Key 或网络访问。
6. API 失败单独显示，不阻塞其他来源，也不影响原有本地检索或 FOFA 专项技能。

接口：异步 store dispatch，op=scopedIntelLookup，参数 engagement、target、sources（internetdb/shodan）、confirmExternal=true、commit（默认 false）。每次仅查询单个 IP；不接受搜索表达式，不调用主动扫描接口。

参考：https://book.shodan.io/developer-apis/internetdb/ 与 https://developer.shodan.io/api 。

离线历史接口：op=scopedIntelHistory，参数 engagement、target。返回来源、采集时间、标准化端口与主机名线索；不会联系外部平台。

尚未实现：其他厂商 REST 接口、ARTEX 自动同步。

## 免费 DNS 情报（第三阶段）

资源 → 测绘中心 → 免费 DNS 情报 · 单域名。登记授权域名，输入完整主机名（不能填 URL、IP 或通配符），确认将域名提交给系统配置的 DNS 解析器，查询 A、AAAA、CNAME；无需商业 API Key。A/AAAA 返回 TTL 时保留。默认预览，可选保存，并可按域名离线查询最近 100 条历史快照。

DNS 解析地址和别名仅是观察记录，不自动生成资产、端口或漏洞，也不扩大授权范围；部分记录查询失败时仍保留成功记录。快照包含错误类别与 TTL；完全相同的连续快照刷新采集时间。

接口：scopedDnsLookup（异步）/ scopedDnsHistory（同步），参数 engagement、target；查询需 confirmExternal=true，可选 commit=true。数据保存在原项目 SQLite 的 dns_intel_snapshot 表。

本阶段只解析单个已知域名，尚未接入 CT 证书透明度和自动子域发现，也未实现 ARTEX 同步。


## 证书透明度与子域线索（第四阶段）

资源 → 测绘中心 → 证书透明度 · 子域线索。登记明确的 *.example.test 通配授权范围，输入 example.test（不带星号）。仅登记根域名不会允许子域枚举。确认向 crt.sh 提交域名后查询公开历史证书名称；免费、无需 API Key。

只保留该根域下且命中授权范围的具体主机名，去重并记录来源、证书 ID 和可用到期时间。通配证书、跨域 SAN、无效名称均排除。最多 1000 个名称，8 MiB 响应上限，25 秒超时，不自动重试。默认预览，可选保存至当前项目 SQLite 的 ct_intel_snapshot，离线读取最近 20 条快照。

接口：scopedCtLookup（异步）/ scopedCtHistory（同步），参数 engagement、target；查询需 confirmExternal=true，可选 commit=true。历史证书不代表域名当前解析或服务存活；不自动扩大范围、生成资产或启动扫描。

当前未完成：ARTEX 情报同步及其他厂商 REST API。


## 统一子域线索（第五阶段）

资源 → 测绘中心 → 统一子域线索 · CT + subfinder。输入已登记 *.域名 范围对应的根域名。默认只读取最近保存的 CT 快照，不触网；可勾选 subfinder 并确认向其配置的被动数据源提交域名。通过已有 resolveTool 查找本机工具（包括 ARTEX 工具目录），不下载或另建工具链，不使用主动解析或扫描参数。subfinder 使用当前安装版本及其配置的来源；部分来源可能需要 API Key。

合并去重具体子域名，保留 crt.sh/subfinder 来源，最多 1000 项；工具缺失、失败或超时时仍可查看已有 CT 线索，状态如实显示。可选保存到当前项目 SQLite subdomain_intel_snapshot，离线读取最近 20 条快照。选择某一子域的「填入 DNS 核验」只填入现有 DNS 面板，须另行确认并执行；解析结果不会自动添加资产或扩大授权范围。

接口：scopedSubdomains（异步）、scopedSubdomainHistory（同步）；参数 engagement、target；useSubfinder=true 时需 confirmExternal=true，commit=true 可保存。工具执行上限 75 秒、2 MiB stdout/stderr 缓冲，无 shell。

限制：未自动运行 CT 新查询、批量 DNS 验证或 ARTEX 同步；目前仅复用最近一条保存的 CT 快照。
