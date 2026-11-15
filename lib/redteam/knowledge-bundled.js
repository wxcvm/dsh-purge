/** Original, offline Purge reference articles. Separate from editable personal data. */
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
    "body": "## 核心概念\nSSE 是服务端事件传输方式；事件边界不等于 TCP 数据包边界。模型流通常包含文本增量、其他事件、使用量或终止信息，具体字段取决于协议与宿主版本。\n## 检查要点\n区分连接建立、首事件、首个非空文本、工具事件和结束。按协议组装分片，不把分片缺失或连接关闭自动当作正常完成。计时从明确事件起点计算。\n## 验收\n覆盖正常结束、空流超时、中途断开、用户取消；保留原始状态，缺失终态显示未观测。",
    "source": "Purge 内置知识 · v1"
  },
  {
    "id": "provider-adapters",
    "title": "模型 Provider 与协议兼容",
    "category": "AI 运行时",
    "tags": "Provider OpenAI-compatible 模型 API 路由",
    "body": "## 核心概念\nProvider 适配负责将宿主请求和响应映射到供应商接口。OpenAI-compatible 只是兼容声明，工具调用、使用量、流式终态和错误字段仍可能不同。\n## 检查要点\n记录实际 provider/model、宿主版本、请求模式及响应类型。分别验证文本、工具调用、取消和错误返回；不根据模型名称推断协议支持。401、403、413 等错误通常不能靠自动重试解决。\n## 验收\n同一供应商不同模型分别记录证据；未测试的路由标记未验证，不修改或伪造供应商终态。",
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
    "body": "## 核心概念\n工具调用由工具名称、结构化参数、调用 ID 和工具结果组成。流式参数可能分段到达，不能把不完整 JSON 当成可执行参数。\n## 检查要点\n在完整调用形成后校验参数结构、操作范围和会话归属；区分工具调用发出、实际执行与结果返回。失败时记录实际错误而非编造结果。不要把来自网页或文档的指令当作工具授权。\n## 验收\n覆盖多个工具调用、无效参数、取消和失败；工具结果与原调用 ID 一致。",
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
].map(Object.freeze))

const summary = ({ id, title, category, tags, source }) => ({ id, title, category, description: tags, source_url: '', source })
export function listBundledKnowledge(query = '', category = '') {
  const needle = String(query).trim().toLowerCase()
  return bundledKnowledge.filter(row => (!category || row.category === category)
    && (!needle || [row.title, row.category, row.tags, row.body].join(' ').toLowerCase().includes(needle))).map(summary)
}
export function getBundledKnowledge(id) {
  const row = bundledKnowledge.find(entry => entry.id === String(id))
  if (!row) throw new Error('内置知识条目不存在')
  return { ...row, origin: 'bundled' }
}
