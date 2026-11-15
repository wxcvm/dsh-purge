# 外部被动资产情报（第一阶段）

管理 → 环境 → 测绘中心 → 外部被动情报 · 单 IP。

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

管理 → 环境 → 测绘中心 → 免费 DNS 情报 · 单域名。登记授权域名，输入完整主机名（不能填 URL、IP 或通配符），确认将域名提交给系统配置的 DNS 解析器，查询 A、AAAA、CNAME；无需商业 API Key。A/AAAA 返回 TTL 时保留。默认预览，可选保存，并可按域名离线查询最近 100 条历史快照。

DNS 解析地址和别名仅是观察记录，不自动生成资产、端口或漏洞，也不扩大授权范围；部分记录查询失败时仍保留成功记录。快照包含错误类别与 TTL；完全相同的连续快照刷新采集时间。

接口：scopedDnsLookup（异步）/ scopedDnsHistory（同步），参数 engagement、target；查询需 confirmExternal=true，可选 commit=true。数据保存在原项目 SQLite 的 dns_intel_snapshot 表。

本阶段只解析单个已知域名，尚未接入 CT 证书透明度和自动子域发现，也未实现 ARTEX 同步。


## 证书透明度与子域线索（第四阶段）

管理 → 环境 → 测绘中心 → 证书透明度 · 子域线索。登记明确的 *.example.test 通配授权范围，输入 example.test（不带星号）。仅登记根域名不会允许子域枚举。确认向 crt.sh 提交域名后查询公开历史证书名称；免费、无需 API Key。

只保留该根域下且命中授权范围的具体主机名，去重并记录来源、证书 ID 和可用到期时间。通配证书、跨域 SAN、无效名称均排除。最多 1000 个名称，8 MiB 响应上限，25 秒超时，不自动重试。默认预览，可选保存至当前项目 SQLite 的 ct_intel_snapshot，离线读取最近 20 条快照。

接口：scopedCtLookup（异步）/ scopedCtHistory（同步），参数 engagement、target；查询需 confirmExternal=true，可选 commit=true。历史证书不代表域名当前解析或服务存活；不自动扩大范围、生成资产或启动扫描。

当前未完成：ARTEX 情报同步及其他厂商 REST API。


## 统一子域线索（第五阶段）

管理 → 环境 → 测绘中心 → 统一子域线索 · CT + subfinder。输入已登记 *.域名 范围对应的根域名。默认只读取最近保存的 CT 快照，不触网；可勾选 subfinder 并确认向其配置的被动数据源提交域名。通过已有 resolveTool 查找本机工具（包括 ARTEX 工具目录），不下载或另建工具链，不使用主动解析或扫描参数。subfinder 使用当前安装版本及其配置的来源；部分来源可能需要 API Key。

合并去重具体子域名，保留 crt.sh/subfinder 来源，最多 1000 项；工具缺失、失败或超时时仍可查看已有 CT 线索，状态如实显示。可选保存到当前项目 SQLite subdomain_intel_snapshot，离线读取最近 20 条快照。选择某一子域的「填入 DNS 核验」只填入现有 DNS 面板，须另行确认并执行；解析结果不会自动添加资产或扩大授权范围。

接口：scopedSubdomains（异步）、scopedSubdomainHistory（同步）；参数 engagement、target；useSubfinder=true 时需 confirmExternal=true，commit=true 可保存。工具执行上限 75 秒、2 MiB stdout/stderr 缓冲，无 shell。

限制：未自动运行 CT 新查询、批量 DNS 验证或 ARTEX 同步；目前仅复用最近一条保存的 CT 快照。


## 统一资产关联（第六阶段）

管理 → 环境 → 测绘中心 → 统一资产关联 · 离线清单。输入已登记的精确域名或明确 *.域名 范围对应的根域名，点击生成关联清单。

离线读取最近的 CT、合并子域、DNS 快照以及每个 IP 最新的 InternetDB / Shodan 历史观察。域名清单限定所选根域及授权范围；IP 清单包含项目内已保存且明确命中 IP/CIDR 授权规则的资产（可能包括未与所选域名关联的项目 IP）。DNS A/AAAA/CNAME 关系保留采集时间与可用 TTL；未获 IP 授权的解析地址和范围外别名仅计数，不进入导出。未知传输协议的历史端口保持 unknown，不写入实时端口表或漏洞表。

接口 scopedIntelInventory（同步），参数 engagement、target，返回 purge.asset-intel.v1：names、ips、edges、excluded、truncated。面板可查看关联清单与可复制的 JSON；资产遮蔽开启时隐藏详情和 JSON。最多 500 个域名/500 个 IP，每个域名最多 32 条 DNS、每个 IP 最多 64 个历史端口；限量时标注截断。只读取保存的证据，不联网、不执行扫描、不修改资产或授权范围。历史 DNS 不等于当前解析，历史端口不等于实时开放。

本轮仅提供结构化导出，ARTEX 接收端、传输与自动同步仍待开发；没有验证真实环境端到端导入。


## ARTEX 本机直接同步（第七阶段扩展）

两端使用独立的随机情报令牌（至少 32 字符），ARTEX 服务端设置 ARTEX_PURGE_INTEL_TOKEN、ARTEX_PURGE_INTEL_COMPANY_ID；Purge/DSH 宿主设置同值 DSH_PURGE_ARTEX_INTEL_TOKEN、DSH_PURGE_ARTEX_INTEL_COMPANY_ID。公司必须存在且登记相应域名及 IP/CIDR 范围。不要复用隐私/总览令牌，重启服务使环境变量生效。

进入「资源 → ARTEX」的本机情报同步区，填写已登记域名并生成关联清单，查看接收公司，确认并点击「同步至 ARTEX」。环境 → 测绘中心 → 本地资产中的「打开 ARTEX 情报同步」可带入当前项目与目标。固定发送到 127.0.0.1:8787，先做无凭据健康检查，随后 POST /api/purge/intel-bridge；不支持任意远程地址或重定向。发送前重新构建当前项目授权清单（可能包含该项目其他已授权 IP），接收端独立验证整份数据，不创建已验证资产、端口、漏洞、任务。成功显示公司及快照 ID；失败或回执不明确时请在 ARTEX 资产同步 → Purge 情报查询历史。重复证据可复用快照。

接口 scopedIntelSyncConfig（同步，仅配置状态、公司 ID 和固定地址，无令牌）；scopedIntelSync（异步，engagement、target、companyId、confirm=true）。8 MiB 上限，15 秒请求超时。仅手动触发传输，没有定时任务或智能体自动分析。


Purge 联合工作台的「配对配置」可直接保存 ARTEX 公司 ID 和独立情报令牌，无需重启 Purge。令牌不回显，不进入普通平台配置；保存在本机工作区 `artex-intel-pairing.json`，启用已有 `DSH_PURGE_SECRET_KEY` 时加密。宿主环境变量若设置任一配对字段，整对由宿主管理，不混用本机保存值。解除本机配对仅清除 Purge 保存值，不撤销 ARTEX 服务端凭据。保存后检测新版本 ARTEX 的只读配对接口，不发送情报。旧版 ARTEX 仍需在服务端设置令牌与公司 ID。
