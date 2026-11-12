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
