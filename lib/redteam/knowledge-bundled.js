/** Offline Purge reference articles. Separate from editable personal data. */
import { loadFujiangReferences } from './fujiang-reference.js'
export const bundledKnowledge = Object.freeze([
  {
    "id": "http-basics",
    "title": "HTTP 请求、响应与状态码",
    "category": "网络基础",
    "tags": "HTTP HTTPS 请求头 状态码 缓存",
    "body": "## 核心概念\nHTTP 交换由请求方法、目标、头字段、可选正文和响应状态组成。200 是成功响应，204 无正文，301/302 表示重定向，401 是未认证，403 是拒绝访问，404 表示未找到或隐藏资源；429 常代表限流，5xx 通常表示服务端或上游问题。\n## 排查顺序\n先记录实际 URL、方法、状态和响应头，再比较重定向、Content-Type、响应体及耗时。代理返回的状态不一定来自源站；检查 Server、Via、请求 ID 和证书链。缓存命中与真实服务器处理应分开记录。\n## 验收\n同一请求在相同条件下复现；不把 200 当作业务成功。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "dns-tls",
    "title": "DNS、DoH 与 TLS 连接排查",
    "category": "网络基础",
    "tags": "DNS DoH TLS SNI 证书 Fake-IP",
    "body": "## 核心概念\nDNS 将域名映射为地址；DoH 将解析请求封装在 HTTPS 中。TLS 握手负责身份认证及加密协商；SNI 用于告诉服务器请求的主机名，证书需与域名匹配。\n## 排查顺序\n区分解析失败、TCP 连接失败、TLS 握手失败和 HTTP 错误。比较系统解析与代理解析、IPv4/IPv6、证书有效期及系统时间。Fake-IP 模式必须由对应代理维护地址映射；不要让另一解析器无意覆盖虚拟地址。\n## 验收\n同一域名记录实际解析路径、代理模式和握手结果；不得用单一 DNS 耗时推断下载速度。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "proxy-routing",
    "title": "代理、路由与网络故障定位",
    "category": "网络基础",
    "tags": "代理 VPN 路由 TCP 连接 重试",
    "body": "## 核心概念\n系统代理通常仅影响遵守代理设置的应用；TUN/VPN 在网络层接管流量。DNS 和流量路由是两个独立环节。\n## 排查顺序\n记录代理端口、系统代理、TUN 状态和目标域名。确认本地端口监听，再检查 DNS、TCP、TLS 和 HTTP。网络切换后若旧连接断开，应验证新连接能建立，避免把旧连接的失败误判为全部网络不可用。\n## 验收\n分别比较直连、代理、网络切换后的请求结果；保持同一节点和文件进行速度对照。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "web-auth",
    "title": "身份认证与访问控制基础",
    "category": "Web 安全",
    "tags": "认证 授权 session cookie RBAC OAuth",
    "body": "## 核心概念\n认证回答“你是谁”，授权回答“你可以做什么”。服务端应对每次受保护操作检查权限，而不仅依赖前端隐藏按钮。会话 Cookie 的 Secure、HttpOnly、SameSite 属性提供不同层面的保护。\n## 检查要点\n建立角色、资源和操作矩阵，在明确授权的测试环境验证普通用户与管理员的读写边界。关注资源所有者、租户隔离、会话失效、退出登录以及服务端审计。不得使用真实账号凭据作为报告示例。\n## 验收\n未授权操作不产生状态变化；权限恢复后正常功能仍可使用。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "api-contract",
    "title": "API 参数、错误与幂等设计",
    "category": "Web 安全",
    "tags": "API JSON schema 幂等 限流 422",
    "body": "## 核心概念\nAPI 合约定义请求字段、返回格式和错误语义。幂等表示重复执行同一操作不会产生额外副作用；不等于所有请求都可安全重试。\n## 检查要点\n验证必填字段、类型、边界值、未知字段及错误结构。对写入操作记录请求 ID、幂等键和真实结果；超时后先确认操作是否已提交。401/403/422 通常需修正身份、权限或参数，而非盲目重复。\n## 验收\n重复请求不导致重复创建；错误响应清晰且不暴露凭据或内部栈。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "browser-security",
    "title": "浏览器安全边界与 CSP",
    "category": "Web 安全",
    "tags": "CORS CSP XSS CSRF 浏览器",
    "body": "## 核心概念\n同源策略限制不同源页面互读数据。CORS 是服务端对跨源读取的授权，CSP 限制资源加载和脚本执行。CSRF 与 XSS 是不同问题，不能由一个响应头包治百病。\n## 检查要点\n审查允许的 Origin、凭据策略、CSP 指令、Cookie 属性和状态变更接口的防护。用隔离测试环境验证业务场景，不把浏览器阻断的响应当作服务端没有处理请求。\n## 验收\n合法前端正常工作，未授权跨源读取和意外状态变更被阻止；记录实际浏览器行为。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "dependency-inventory",
    "title": "依赖清单、锁文件与供应链排查",
    "category": "工程安全",
    "tags": "SBOM pnpm lockfile npm 依赖 CVE",
    "body": "## 核心概念\n依赖清单描述直接依赖，锁文件固定解析结果，SBOM 可记录组件和版本。安全公告必须结合真实安装版本和实际使用路径判断。\n## 检查要点\n从项目锁文件和构建产物取得版本；区分直接、传递、开发和运行依赖。核对公告影响范围、修复版本和兼容性。依赖安装策略报错应先查明触发原因，不把关闭策略作为默认修复。\n## 验收\n更新锁文件后运行相关测试，确认发布产物确实包含修复版本。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "vulnerability-triage",
    "title": "漏洞分级、证据与修复验证",
    "category": "安全评估",
    "tags": "CVE CVSS EPSS 漏洞 误报 证据",
    "body": "## 核心概念\nCVE 是漏洞标识，CVSS 描述技术严重程度，EPSS 是利用可能性的概率估计。三者不能直接等同于某个资产已受影响或已被攻击。\n## 检查要点\n记录组件、确切版本、暴露面、前置条件和供应商公告。将扫描候选与已核实发现分离；优先使用无副作用的证据和授权环境验证。风险排序同时考虑业务影响、可达性和补救成本。\n## 验收\n报告给出证据、影响范围、修复建议和复测结果；未知项保持未知。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "asset-inventory",
    "title": "资产清单与授权范围管理",
    "category": "安全评估",
    "tags": "资产 域名 IP 所有权 范围 资产台账",
    "body": "## 核心概念\n资产记录应包含标识、类型、归属、来源、更新时间和证据。域名解析到共享 IP 并不证明所有同 IP 的服务都属于同一组织。\n## 检查要点\n去重并区分历史记录、当前观测和推断关系。明确允许的资产、时间、方法和排除项。第三方平台数据只作线索；通过所有者确认或可信资产清单核对归属。\n## 验收\n所有测试与报告条目能追溯到明确范围和证据。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "logging-evidence",
    "title": "日志、证据与敏感信息处理",
    "category": "安全评估",
    "tags": "日志 证据 脱敏 token cookie 审计",
    "body": "## 核心概念\n原始日志、摘要和结论属于不同证据层次。请求 ID、时间、环境和来源帮助对账；摘要不能替代缺失的原始事件。\n## 检查要点\n共享日志前移除认证头、Cookie、私钥、连接串和个人信息。保留必要的错误码、状态和时间，而非复制整个请求正文。对敏感原始材料遵守最小访问与本地保存原则。\n## 验收\n读者能从脱敏证据理解结论，且没有不必要的凭据泄露。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "stream-sse",
    "title": "SSE 流式响应与分片生命周期",
    "category": "AI 运行时",
    "tags": "SSE streaming stream chunk delta 流式 首字",
    "body": "## 核心概念\nSSE 是服务端事件传输方式；事件边界不等于 TCP 数据包边界。模型流通常包含文本增量、其他事件、使用量或终止信息，具体字段取决于协议与宿主版本。\n## 检查要点\n区分连接建立、首事件、首个非空文本、工具事件和结束。按协议组装分片，不把分片缺失或连接关闭自动当作正常完成。计时从明确事件起点计算。\n## 验收\n覆盖正常结束、空流超时、中途断开、用户取消；保留原始状态，缺失终态显示未观测。\n## 实战排查：流连接成功，但页面一直无输出\n1. 先看响应 Content-Type 是否符合实际接口约定，再检查代理是否缓冲响应。HTTP 200 只说明连接获得成功响应，不代表模型已经产生文本。\n2. 在测试环境分别记录连接建立、首个 SSE 事件、首个非空文本、结束事件的时间。若先收到 reasoning，首文本仍可能未出现。\n3. SSE 的空行用于结束事件，多个 data 行需要合并；网络读取可能把 UTF-8 字符或一条事件拆成多段。应由增量解码器保留未完成内容，而不是对每个网络块直接 JSON.parse。\n4. 区分已收到终态后关闭连接与没有终态的意外断开。只有后者且符合该协议的错误语义时才判断传输异常。\n验收案例：将一条测试事件拆成两段，再将两条事件合并成一次读取，解析结果应一致；空流结束不能假装正常完成。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "provider-adapters",
    "title": "模型 Provider 与协议兼容",
    "category": "AI 运行时",
    "tags": "Provider OpenAI-compatible 模型 API 路由",
    "body": "## 核心概念\nProvider 适配负责将宿主请求和响应映射到供应商接口。OpenAI-compatible 只是兼容声明，工具调用、使用量、流式终态和错误字段仍可能不同。\n## 检查要点\n记录实际 provider/model、宿主版本、请求模式及响应类型。分别验证文本、工具调用、取消和错误返回；不根据模型名称推断协议支持。401、403、413 等错误通常不能靠自动重试解决。\n## 验收\n同一供应商不同模型分别记录证据；未测试的路由标记未验证，不修改或伪造供应商终态。\n## 实战排查：同一模型非流式成功，流式却失败\n建立四列兼容矩阵：普通文本、流式文本、工具调用、用户取消。对同一个模型逐项记录请求方式、实际 HTTP 状态、宿主终态和使用量是否存在。不要把某一列通过扩展为整个 Provider 通过。\n- HTTP 401/403：先核对认证、授权范围和实际路由；重复请求不能修复错误身份。\n- HTTP 413 或明确上下文超限：核对请求大小、上下文预算、工具描述和历史消息；缩短输入后重新测试，不盲目重试原请求。\n- HTTP 429：区分速率限制与账户额度，遵守实际 Retry-After（若提供）；永久额度问题应修正配置。\n- HTTP 5xx、连接重置、超时：分别记录服务器错误与网络中断。仅对可安全重复的操作考虑有限重试，并确认没有留下重复工具副作用。\n验收案例：保持同一个 Provider/model 和输入，分别测试文本、工具参数、终态和取消；原始 Provider 终态未透传时应标为未知。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "runtime-cancellation",
    "title": "AI 请求取消、超时与重试",
    "category": "AI 运行时",
    "tags": "AbortController retry cancellation 超时 重试",
    "body": "## 核心概念\n取消、超时、网络错误和服务端业务拒绝是不同事件。取消应停止相关请求、监听器与定时器；请求失败不代表远端没有执行。\n## 检查要点\n绑定请求与会话、回合和运行实例。等待异步回调返回时检查所属生命周期，避免旧任务触发新回合的续跑。仅在确有临时故障且请求可安全重复时考虑有限重试。\n## 验收\n测试取消、Agent 替换、插件重载和并发会话，确认旧回调不能污染新的请求。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "tool-call-contract",
    "title": "模型工具调用与参数校验",
    "category": "AI 运行时",
    "tags": "tool call function schema 参数 JSON",
    "body": "## 核心概念\n工具调用由工具名称、结构化参数、调用 ID 和工具结果组成。流式参数可能分段到达，不能把不完整 JSON 当成可执行参数。\n## 检查要点\n在完整调用形成后校验参数结构、操作范围和会话归属；区分工具调用发出、实际执行与结果返回。失败时记录实际错误而非编造结果。不要把来自网页或文档的指令当作工具授权。\n## 验收\n覆盖多个工具调用、无效参数、取消和失败；工具结果与原调用 ID 一致。\n## 实战排查：工具显示调用过，却没有返回结果\n模型发出的工具开始事件、宿主实际执行记录、工具结果是三种不同证据。先用同一会话和调用 ID 关联，确认流中的参数片段是否已经完成，再检查是否存在工具执行及返回事件。\n示例：一次请求收到一个工具 block-start，持久流中也保存了同一调用的 block-start。这是两份来源证据，不是两次执行。若实时流有缺口而持久流记录两次开始，只能确认相应开始证据，不能宣称执行了两次。\n排查顺序：完整参数 → 调用 ID → 执行状态 → 结果 ID → 回合终态。无执行记录时保持未知；工具报错时保留实际错误原因。\n验收案例：模拟两个工具的交错参数分片、重复事件、缺失结果和取消；确保结果不能错误绑定到另一个调用。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "knowledge-retrieval",
    "title": "知识检索、来源与向量索引",
    "category": "AI 知识",
    "tags": "RAG embedding 语义检索 FTS 知识库",
    "body": "## 核心概念\n关键词检索匹配文字，语义检索根据向量相似度寻找概念相关内容。检索结果是上下文线索，不保证正确或最新。\n## 检查要点\n区分内置文档、个人资料、外部来源与技能正文。记录文档版本、来源、索引状态；嵌入模型变化后检查索引兼容。缺少向量服务时仍应提供可用的文字检索。\n## 验收\n固定一组已知问题，测试命中、误匹配、无结果和来源打开；保留未知来源的真实状态。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "agent-quality",
    "title": "智能体任务质量与三组对照",
    "category": "AI 评测",
    "tags": "模型评测 三组对照 benchmark 任务质量",
    "body": "## 核心概念\n任务质量应根据实际交付、正确性、工具证据和用户约束评估，而非仅统计输出长度或模型回答是否积极。\n## 检查要点\n使用相同模型、宿主版本、参数和任务，比较原版宿主、当前插件和候选版。记录原始输出、工具调用与实际结果；区分真实采集和合成样本。未采集的案例不能计作通过。\n## 验收\n报告每组覆盖范围、正确性、耗时和异常；只有真实对照支持的结论才称作效果提升。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "purge-patch-state",
    "title": "Purge 补丁状态与宿主兼容",
    "category": "Purge 使用",
    "tags": "清洗台 补丁 宿主 运行版本 磁盘",
    "body": "## 核心概念\n清洗台的磁盘补丁状态、宿主版本、活动进程加载的代码是三个不同层面。磁盘状态已应用不意味着当前进程已经加载。\n## 检查要点\n在状态总览确认实际运行版本及宿主位置；在补丁页检查已应用、待处理、未匹配和子项差异。更新后重新核对活动进程与安装副本。未匹配的补丁应先查宿主版本与实际调用路径。\n## 验收\n重启后正常进入页面、检查运行诊断、完成正常请求和取消测试；报告真实通过与未验证项。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "purge-local-workflow",
    "title": "Purge 技能与知识库使用指南",
    "category": "Purge 使用",
    "tags": "Purge 技能 知识 ARTEX 本地 导入",
    "body": "## 核心概念\n技能描述任务流程和工具用法，知识文档解释概念与记录事实。二者相关但存储及管理职责不同。\n## 使用顺序\n在资源中的技能与知识库浏览内置资料或全库检索；在技能目录检查来源和可用性；将自己的笔记、文档及任务经验保存在个人资料。ARTEX 资料通过本地适配器读取，缺失、空库及不可用应分开显示。\n## 验收\n即使未导入任何资料、未连接 ARTEX 或向量模型，也能打开内置文档；用户资料仍独立编辑和备份。",
    "source": "Purge 内置知识 · v1"
  }
,
{
    "id": "http-cache",
    "title": "HTTP 缓存与条件请求",
    "category": "网络基础",
    "tags": "ETag Cache-Control 304 缓存",
    "body": "## 核心概念\n缓存控制决定响应可否重用及有效期；ETag 与 Last-Modified 可用于条件请求，304 表示现有缓存仍可使用。\n## 检查要点\n对比 Cache-Control、Age、Vary 和 ETag；区分浏览器、代理与源站缓存。对用户相关响应检查是否被共享缓存错误复用。\n## 验收\n同一资源更新后能正确失效，私有数据不被共享缓存返回。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "ipv6-dual-stack",
    "title": "IPv4 / IPv6 双栈故障排查",
    "category": "网络基础",
    "tags": "IPv6 AAAA A 双栈 Happy Eyeballs",
    "body": "## 核心概念\n双栈系统可能同时拥有 IPv4 与 IPv6 路径，DNS 返回地址不等于对应网络路径可达。\n## 检查要点\n分别记录 A/AAAA、连接耗时、路由与代理支持；排查 IPv6 黑洞和切网后地址变化，比较同一目标的两种路径。\n## 验收\n正常双栈或单栈环境都能建立连接，故障有明确的地址族证据。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "tls-cert-chain",
    "title": "证书链与 HTTPS 信任",
    "category": "网络基础",
    "tags": "TLS CA 证书链 SAN HTTPS",
    "body": "## 核心概念\n证书链将服务器证书连接到受信根；域名匹配、有效期、用途和系统信任共同决定验证结果。\n## 检查要点\n检查 SAN、有效期、链中间证书和系统时间，区分证书错误与代理握手失败；不要通过永久关闭验证掩盖错误。\n## 验收\n正常信任链成功，失效或不匹配证书产生明确错误。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "api-pagination",
    "title": "API 分页与数据一致性",
    "category": "工程安全",
    "tags": "分页 cursor offset 去重 数据一致性",
    "body": "## 核心概念\noffset 分页易受并发写入影响，游标分页依赖稳定排序和游标语义。\n## 检查要点\n记录排序键、游标、页大小和总量来源；区分当前页条数与全集总量，处理重复或缺失记录。\n## 验收\n翻页无重复、无遗漏，空页和失效游标有明确反馈。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "sqlite-local",
    "title": "SQLite 本地知识存储与迁移",
    "category": "工程安全",
    "tags": "SQLite WAL transaction migration 数据库",
    "body": "## 核心概念\nSQLite 事务保证一组写入的原子性，WAL 支持读写并发；运行中的数据库文件不能仅凭单个文件复制判断备份完整。\n## 检查要点\n检查 schema 版本、事务边界和索引；迁移先验证旧数据可读，保留历史与个人资料，使用受支持的备份方式。\n## 验收\n重启后数据仍可读取，失败事务不留下半写入状态。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "release-ci",
    "title": "发布产物、CI 与实机验收",
    "category": "工程安全",
    "tags": "CI release build 版本 产物",
    "body": "## 核心概念\n源码测试、生成产物一致性与实际安装运行属于不同证据。CI 通过不能证明所有设备和宿主都正常。\n## 检查要点\n记录确切提交、版本、构建产物和测试范围；比较生成文件，确认实际安装副本；不将排队任务标记成功。\n## 验收\n安装、升级、回退和正常功能在目标环境分别验收。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "secret-handling",
    "title": "凭据管理与最小暴露",
    "category": "安全评估",
    "tags": "secret token credential key 凭据",
    "body": "## 核心概念\n凭据用于证明身份，日志、配置备份及知识历史可能意外保留其内容。\n## 检查要点\n用环境变量或受控密钥存储；报告仅保留必要元数据。发现泄露时撤销或轮换，再核对使用记录。\n## 验收\n正常访问可用，报告和共享备份不包含真实密钥。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "security-headers",
    "title": "HTTP 安全响应头检查",
    "category": "Web 安全",
    "tags": "HSTS CSP frame-ancestors nosniff",
    "body": "## 核心概念\n安全响应头为浏览器提供防护策略，但不会替代服务端授权和输入处理。\n## 检查要点\n检查 HSTS、CSP、frame-ancestors 与 Content-Type；确认策略在正常页面、错误响应和重定向中是否一致。\n## 验收\n合法页面正常，策略实际生效且不会造成业务不可用。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "stream-events",
    "title": "流式事件与终态对账",
    "category": "AI 运行时",
    "tags": "stream event finish durable terminal 终态",
    "body": "## 核心概念\n实时事件与持久化事件可能存在延迟、重复或缺失，终态需要关联同一请求和回合。\n## 检查要点\n按实际 attempt ID 和事件序号对账，区分实时终态、持久终态与未观测结束；冲突保留证据而非覆盖。\n## 验收\n晚到事件不影响新请求，重复事件不重复计数，缺失终态显示未知。\n## 实战排查：实时流与持久事件不一致\n在清洗台记录同一 attempt 的会话、回合、步骤、提交序号以及终态来源。最大分片 index + 1 表示序号覆盖范围，并不等于实际接收分片数。\n例如收到了 index=0 和 index=2：序号覆盖为 3，实收为 2，仍有缺口。后续持久化事件如果包含缺失的工具开始或文本，只补充持久证据，不能补造当时的到达时间。\n终态与回合结算也必须分开：finish=tool-calls 只说明模型生成到工具调用阶段；committed 表示事件已提交；turn completed 才是回合结束，但仍不能证明任务正确。\n验收案例：让旧 attempt 的持久事件晚于下一次 start 到达，按原提交 seq 匹配，确认新请求没有继承旧终态、工具计数或模型路由。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "runtime-metrics",
    "title": "首文本延迟与吞吐评估",
    "category": "AI 评测",
    "tags": "TTFT token throughput 延迟 性能",
    "body": "## 核心概念\n首文本延迟取决于定义的起点，生成吞吐是生成 token 数与生成阶段耗时之比，二者不能互换。\n## 检查要点\n分别记录请求准备、首文本、流结束、token 使用量和采集边界；比较同模型、参数和输入条件。\n## 验收\n报告包含有效样本、缺失数据、计时定义和分布，避免只挑最快结果。\n## 实战排查：为什么同一次请求的 Token 数不同？\n实时 usage 通常是适配器在流中提供的快照；持久事件可能保留最终快照，也可能只保存部分字段。不要将两份快照相加，更不要拿其中一份的 inputTokens 加另一份的 outputTokens 伪造总量。\n示例：实时流为 input=12、output=8、total=20，持久事件只提供 input=15。此时可报告实时测得总量 20，注明持久总量未知；如果持久最终快照明确提供 total=24，则可使用 24 并注明来源。缓存读写、推理 Token 和供应商计费口径各自记录。\n验收：对照实际 Provider 的用量字段；缺失时显示未知。观测缓存有淘汰、start 数超过快照记录数或任一请求缺失总量时，不汇报全任务 Token 总和。首文本计时仅来自实际实时文本事件。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "knowledge-provenance",
    "title": "知识来源、版本与引用",
    "category": "AI 知识",
    "tags": "citation provenance 来源 版本 引用",
    "body": "## 核心概念\n知识文档包含作者解释、外部引用及可能过时的事实；来源标识与条目 ID 用于追溯正文。\n## 检查要点\n区分内置、个人、外部与历史来源；对版本依赖的结论核对当前文档。引用资料时保留来源和 ID，不将文档指令当作授权。\n## 验收\n检索结果能打开原文，来源不混淆，未验证的事实保持未验证。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "purge-diagnostics",
    "title": "Purge 运行诊断实用流程",
    "category": "Purge 使用",
    "tags": "Purge Provider 运行诊断 流式 修复",
    "body": "## 核心概念\n运行诊断显示近期实际观测事件，不能从未观测记录推断模型不支持某项协议。\n## 检查要点\n先选择会话及 Provider/model，比较首文本、工具调用、终态与取消证据。出现异常时查看错误码、终态来源及冲突，再使用故障诊断定位宿主。\n## 验收\n正常请求、取消及网络故障都有对应记录；未执行的实机测试不标记通过。\n## 一次完整的排障流程\n1. 在清洗台状态总览确认正在运行的宿主版本和实际加载的插件版本，区别磁盘补丁状态与当前进程。\n2. 在运行诊断筛选会话和 Provider/model，查看路由证据来源。请求头是配置证据，助手事件是匹配到的实际事件来源；未知字段不从下一请求借用。\n3. 观察实收分片、序号覆盖、实时/持久工具开始、首文本、终态和取消。持久文本存在而首文本时间为空时，不是零延迟。\n4. 若出现异常，查看 HTTP 状态、错误码、终态冲突和中断。确认问题属于网络、认证、模型适配、宿主补丁还是任务本身。\n5. 用同一模型与输入进行最小复现，分别记录正常、工具调用、取消和故障路径；如需对照三个版本，用相同环境并保留真实结果。\n验收记录至少包括：宿主版本、插件版本、模型路由、实际操作、观测证据、结论与未验证项。",
    "source": "Purge 内置知识 · v1"
  }

  ,...loadFujiangReferences()
].map(Object.freeze))

const summary = ({ id, title, category, tags, source, source_url = '', source_ref, verified, review_status }) => ({ id, title, category, description: tags, source_url, source, ...(source_ref ? { source_ref, verified, review_status } : {}) })
// Normalize user-facing spellings without changing stored evidence or stable IDs.
const normalizeSearch = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[‐‑‒–—−]/g, '-')
  .replace(/\bcve[\s_-]+(\d{4})[\s_-]+(\d{4,})\b/g, 'cve-$1-$2')
const searchTerms = value => [...new Set(normalizeSearch(value).match(/cve-\d{4}-\d{4,}\b|[^\s_-]+/g) || [])]
const cvePattern = /^cve-\d{4}-\d{4,}$/
const cveSet = value => new Set(normalizeSearch(value).match(/\bcve-\d{4}-\d{4,}\b/g) || [])
const foldSearch = value => normalizeSearch(value).replace(/[-_\s]+/g, ' ').trim()

export function listBundledKnowledge(query = '', category = '') {
  const needle = foldSearch(query)
  const rows = bundledKnowledge.filter(row => !category || row.category === category)
  if (!needle) return rows.map(summary)
  const terms = searchTerms(query)
  if (!terms.length) return rows.map(summary)
  const score = row => {
    const title = foldSearch(row.title), tags = foldSearch(row.category + ' ' + row.tags), body = foldSearch(row.body)
    const fields = title + ' ' + tags + ' ' + body
    const titleCves = cveSet(row.title), tagCves = cveSet(row.tags), bodyCves = cveSet(row.body)
    const primaryCves = new Set((row.cve_ids || []).map(normalizeSearch))
    let points = (title.includes(needle) ? 12 : 0) + (tags.includes(needle) ? 4 : 0)
    for (const term of terms) {
      if (cvePattern.test(term)) {
        if (!primaryCves.has(term) && !titleCves.has(term) && !tagCves.has(term) && !bodyCves.has(term)) return -1
        // A catalog's own CVE outranks a guide or an incidental historical mention.
        points += primaryCves.has(term) ? 64 : 0
        points += (titleCves.has(term) ? 6 : 0) + (tagCves.has(term) ? 3 : 0) + (bodyCves.has(term) ? 1 : 0)
      } else {
        if (!fields.includes(term)) return -1
        points += (title.includes(term) ? 6 : 0) + (tags.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0)
      }
    }
    return points
  }
  return rows.map((row, index) => ({ row, index, score: score(row) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index).map(entry => summary(entry.row))
}
export function getBundledKnowledge(id) {
  const row = bundledKnowledge.find(entry => entry.id === String(id))
  if (!row) throw new Error('内置知识条目不存在')
  return { ...row, origin: 'bundled' }
}

export const bundledKnowledgeCategories = Object.freeze([...new Set(bundledKnowledge.map(row => row.category))])
