# 外部被动资产情报（第一阶段）

资源 → 测绘中心 → 外部被动情报 · 单 IP。

1. 在当前项目登记自有或获授权的 IP/CIDR 范围。
2. 输入单个 IP，勾选同意将 IP 发送给所选平台，默认免费 InternetDB。
3. 可选 Shodan REST，需在服务端进程环境设置 SHODAN_API_KEY（不通过客户端传输）。
4. 默认仅预览；选择导入才写入现有 SQLite 资产库。只导入明确 TCP/UDP 的新端口，保留已有资产状态与端口。InternetDB 未提供传输协议的端口只作为预览线索。历史第三方记录不是实时确认或漏洞证据。
5. API 失败单独显示，不阻塞其他来源，也不影响原有本地检索或 FOFA 专项技能。

接口：异步 store dispatch，op=scopedIntelLookup，参数 engagement、target、sources（internetdb/shodan）、confirmExternal=true、commit（默认 false）。每次仅查询单个 IP；不接受搜索表达式，不调用主动扫描接口。

参考：https://book.shodan.io/developer-apis/internetdb/ 与 https://developer.shodan.io/api 。

尚未实现：其他厂商 REST 接口、ARTEX 自动同步、未知协议线索持久化。