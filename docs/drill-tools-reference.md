# 作战台工具逐个注释（redteam_* 全量）

> 本文档目前人工维护。新增或删除工具时需同步修改，`test/tool-surface.test.mjs` 会检查工具名称与文档覆盖；不存在自动生成脚本。

具体工具数量及定义以 `lib/redteam/tools.js` 为准。分组只是使用习惯，不是权限边界。

## 当前执行契约（2026-11-27）

本文后续仍保留历史工具参数、数据库字段和兼容接口说明；历史命令示例与攻击链字段不是当前执行授权或可复制的操作手册。工具可用性以 lib/redteam/task-tool-plan.js 的实时契约为准。

- 当前可执行：Nmap / ProjectDiscovery httpx 仅通过 redteam_scan_run 单目标适配器；subfinder / dnsx / Amass 仅通过 redteam_passive_recon 固定被动模式。
- 其余工具均为 unmapped-manual-review：只显示路径/版本信息，不执行目标任务，不得使用通用 Shell、旧 Skill 或 customTools 兜底。
- 主动任务必须有用户明确提供的授权依据与登记范围；redteam_scope_review 只是离线匹配，不证明授权。无范围时仅进行本地记录和证据整理。
- 不执行口令爆破/喷洒、漏洞利用、拒绝服务、目标侧上传、WebShell、隧道部署、持久化、规避检测、横向移动、数据提取或破坏性操作。
- POC / payload / 字典库仅可检索和审阅，不执行其中的代码、请求或命令。

## A. 开局与调度（主会话/指挥用）

_一次演练只开一个靶标；子智能体并发上限默认 3，派活前先占位。_

### `redteam_engagement_open`
打开或创建一次攻防演练靶标（按单位名称），并把**当前会话**绑定到该靶标（子智能体会自动继承）。后续所有资产工具默认作用于它。若靶标已存在则复用其资产库。写入的是本会话的绑定，不会改动其它会话正在用的靶标。

参数：
- `target` — 靶标单位名称，例如「示例科技有限公司」
- `scope` — 用户明确提供的授权范围 CIDR 列表；可为空以便建立本地记录，但 scope 为空时不得启动主动目标任务，也不得把公开资产自动视为授权资产。

### `redteam_session_bind`
把一个**已经存在**的靶标绑定到当前会话（多会话并行时用：每个会话绑自己的靶标，互不串写）。可用靶标 id 或单位名称，省略则列出可绑定的靶标。

参数：
- `engagement` — 靶标 id 或单位名称；省略只列出候选

### `redteam_session_info`
查看**当前会话绑定的是哪个靶标**（会话 id、父会话、根会话、绑定链）。多会话同时开工时，先跑它确认自己没串到别人的靶标上。

### `redteam_task_context`
对资产/关联漏洞任务卡，会返回最多 3 条公开 CVE 候选（`knowledge_candidates`）与本机已安装的相关技能摘要（`related_skills`），还会在有检索关键词时尝试读取已配置的 ARTEX `knowledge.db`，返回 `artex_knowledge`：`status`、`query` 及最多 3 条条目 ID、标题、分类和来源验证标记，不返回知识正文。漏洞有 CVE 时优先按 CVE 搜索，否则使用资产的开放端口产品名或指纹产品名。需要全文时由智能体显式调用 `redteam_artex_knowledge_get(id)`；不自动执行记录中的代码、不修改数据库，也不因历史知识命中就确认当前漏洞。

【只读】把 `redteam_next_action` 返回的 `focus.target` 或 `focus.task_key` 直接作为输入，一次读取核查目标的必要上下文，减少多次查库。

参数：
- `engagement` — 当前靶标（默认会话绑定的靶标）
- `target` — 必填，`asset #8` / `vuln #12`，或者带动作前缀的 `focus.task_key`

返回内容：
- 资产任务：资产 IP、开放端口概要、最近三条测试记录、受阻次数、关联漏洞摘要以及直接挂在资产上的 HTTP 证据索引。
- 漏洞任务：该漏洞摘要、关联资产测试状态、按 `vuln_id` 关联的 HTTP 证据索引。
- 原始 HTTP 请求/响应**不会**放进任务上下文；需要时用 `redteam_http_evidence_query(id=...)` 取具体证据。
- 仅支持带 ID 的任务目标。其它任务仍按 `first_tool` 指引调用对应工具；本工具不执行扫描、不改变状态或分数。

### `redteam_task_block`
当前演练的**持久阻塞任务记录**，与 `redteam_next_action` 共享 SQLite。只有确认了真实阻塞原因才写入；不会自动执行测试或记分。

参数：
- `engagement` — 可选，默认当前会话演练
- `action` — 必填，`block` 记录阻塞、`unblock` 解除、`list` 查看已阻塞任务
- `task_key` — `block` / `unblock` 时必填，原样传入 `focus.task_key`
- `reason` — `block` 时必填，写清确切阻塞原因或缺失条件
- `limit` / `offset` — `list` 的分页参数，默认 30 条，最多 100 条

后续 `redteam_next_action` **自动读取**所有持久阻塞键；`previous_task` 与临时 `blocked_task_key(s)` 保持只读、不会自动落库。条件发生变化后要明确 `unblock`，不把暂时故障永久封禁。

### `redteam_next_action`
只读生成下一步任务卡，返回 `focus`、候选 `actions` 与 `parallel_review`。
- `parallel_review.status=ready` 时，`batch` 只包含明确标记的独立只读记录核查任务（目前是候选漏洞的证据缺口/授权范围关联核对）。
- 同一批最多 `parallel_review.max_parallel` 项（默认 3，随当前并发设置调整）；必须是不同记录 ID，且无依赖、共享可变状态或证据前置关系。其余任务进入 `sequential` 或 `deferred`，不因候选列表靠前就自动并行。
- 子任务只读本地记录与现有证据索引，不访问目标、不扫描、不登录、不验证漏洞、不写库、不再委派。由主会话等待本批返回后统一核对并决定是否更新记录。
- 主动探测、漏洞验证、凭据操作、利用、隧道或内网操作不属于只读批次；当前只有明确列出的专用适配器可执行，其余均保持 unsupported / unmapped，不得改用通用 Shell。
- `child_writes_allowed=false` 表示子智能体不得直接修改事实库；主会话必须核对记录 ID、证据引用和推理依据。

### `redteam_attention`
【只读回报/显式确认】从**当前靶标的同一份 SQLite 事实库**列出子 Agent 最后一条尚未处理的结构化回报。
仅当子 Agent 最终消息末尾明确包含 `redteamReport: {"status":"waiting|blocked|ready|progress|failed|dropped", "blocked_reason":"…", "needs":[{"kind":"…","detail":"…"}]}` 时才记录；普通自然语言不推断状态，也不保存完整消息正文。

- `action=list`（默认）：查询 `items`，每项有 `id/session_id/status/blocked_reason/needs/created_at`；`awaiting_person` 统计 `waiting/blocked`。
- `action=ack` + `report_id`：**精确确认一次**，不会清掉同一子会话随后新增的新回报；确认后旧回报不复活。
- `engagement`：可选；省略按当前会话的靶标绑定解析；不同靶标之间不混排。
- `limit`：默认 20，最大 100。

不使用这项回报更改 `redteam_agent_slot` 并发计数或释放正在运行的子 Agent。没有结构化回报时展示 0 项，不声称无人等待或所有任务已完成。只保存经过基本凭据遮蔽与长度裁剪的状态/需求摘要；不要把凭据原文写在需求字段中。

### `redteam_work_item`
【SuperAgent 持久任务与执行轮次】使用当前演练已经存在的 SQLite，记录同一任务多次分派、精确运行 ID、状态和历史；**不创建真实子会话、不会自动执行、不会替代官方 Agent Teams 任务板或** `redteam_attention`。它的结果是「已记录的工作状态」，不是实际宿主或目标任务已经完成的证明。

参数：

- `action` — 必填：`create` 登记任务；`list` 分页；`get` 查看单条及最多 100 次历史；`assign` 将确切 `session_id/run_id` 记为本轮执行；`report` 在精确宿主结束事件已观察后登记本轮结算；`recovery` 列出需核对的持久化运行记录。
- `engagement` — 当前靶标，默认会话绑定；不同靶标隔离。
- `task_key / role / objective` — `create` 必填。相同 task_key 不覆盖已有记录，重复操作幂等。
- `task_id` — `get / assign / report` 必填。
- `session_id / run_id` — `assign / report` 必填，防止前一轮迟到报告覆盖新轮次。
- `status / summary` — `report`：`waiting|ready|blocked|failed|interrupted` 和结果摘要；摘要进行有限的凭据文本遮蔽。
- `done/dropped` 的最终收口改由工作台人工复核后通过本机 UI 接口完成；模型工具不允许代替操作者关闭任务。
- `limit / offset` — 分页查询，最多 100 条。

宿主真实 `subagent/end` 事件到达时，若演练绑定及 `session_id/run_id` 精确匹配本任务的已登记 Assignment，将仅补记 `host_end_at/host_stop_reason`，不会自动完成或重新执行任务。详情见 [第二阶段真实事件对账](SUPERAGENT_DURABLE_TASKS.zh-CN.md#第二阶段真实子智能体结束事件对账本-pr-增量)。

结算约束：模型工具不会提供人工 `host_checked` 声明，只有已观察到本次精确 `subagent/end` 的任务轮次才可由模型调用 `report` 结算。无结束事件时须在工作台明确核对后人工结算；该勾选是操作者声明而不是独立宿主证明。

恢复语义：宿主重启后 `recovery` 显示 `host_activity=unverified`，**并不推断原子智能体已退出**；必须先核对其真实会话和执行状态，再显式记 `interrupted` 并分配新轮次。没有自动重启、自动重派、自动批准或后台任务。本轮完整使用说明见 [SuperAgent 持久任务阶段一](SUPERAGENT_DURABLE_TASKS.zh-CN.md)。

### `redteam_agent_slot`
【主会话派活前后用】执行智能体的并发闸门：同一靶标的有效上限由 settings.json / REDTEAM_MAX_AGENTS 控制（默认 3，用户可调整）。action=status 返回有效 max、used 和 free；action=acquire 占一个名额（满了会直接拒绝）；action=release 释放（子智能体结束时服务端也会自动释放）。

参数：
- `action` — status 查看 / acquire 占用 / release 释放
- `label` — acquire 时的任务标签，例如「信息收集：主域与 C 段」
- `key` — acquire 可指定稳定任务键，重复申请复用同一预留（保留原始时间）；未提供时沿用自动生成键。release 指定释放键，省略则沿用原有释放方式。

注册表不可用时 `free` 为 null，`free_upper_bound` 仅表示已知占用推算的上界；原有配置上限不变。

「智能体」页现通过现有 `agentsStatus` 只读接口按根会话展示近期任务交接：活动预留（`reserved`）、已关联子运行（`delegated`）、正常结束且有最终回复但未验收（待核验）或异常结束（需关注）。来源为现有 `redteam_agent_slot` 的预留与持久交接索引，每个会话只显示自己的任务键；不自动更新工作记录，也不把子智能体结束当成任务完成。页面每次只显示最近 12 条，完整状态仍可通过 `redteam_agent_slot(action=status)` 查看。

### `redteam_tool_select`

【只读】按任务类型发现本机工具路径，并返回当前审查过的 Skill key、执行策略和范围要求。规划不执行目标任务，也不因路径或版本探针成功而宣称工具可用于目标操作。

当前允许的工具链：
- `nmap`：仅 `redteam_scan_run`，单目标，必须匹配用户明确提供并登记的授权范围。
- `httpx`：仅 `redteam_scan_run`，单目标，使用 ProjectDiscovery 版本，不使用 Python httpx。
- `subfinder` / `dnsx` / `amass`：仅 `redteam_passive_recon` 的固定被动模式；每次向外部数据源或 DNS 解析器提交域名/主机名前，必须取得本次明确同意并传 `confirm_external=true`。
- 其余工具目前均为 `unmapped-manual-review`：即使路径存在也不执行，不得猜测命令或使用通用 Shell 兜底。

参数：
- `task` — `domains`、`services`、`web`、`vulns`、`internal`、`identity`、`connectivity`
- `verify` — 可选；`true` 仅运行已定义的本地版本参数，不访问目标。
- `include_environments` — 可选；只展示当前已发现的 WSL / Docker / SSH Kali 环境，不自动切换或执行远端任务。

关键输出：
- `skillRequirements[].key` — 必须逐个通过 `redteam_skill_read` 完整读取；当前根会话读取状态会返回 `read` / `not-read`。Nmap/httpx 与被动侦察执行入口会强制核验 30 分钟内的读取记录；缺失、截断或过期时停止。
- `executionPolicy=dedicated-adapter` — 只能使用返回的专用适配器。
- `executionPolicy=manual-review-only` — 需要针对本次工具、目标和动作的明确确认；当前没有此类自动执行入口。
- `executionPolicy=unmapped-manual-review` — 没有经过审查的 Skill/参数契约；不得执行。
- `automaticExecutionAllowed` 始终为 false。范围复核是离线检查，不证明授权。
### `redteam_preflight`
【开工前必须跑一次】平台技能与资源自检：核对当前宿主、已安装 Skill、允许适配器的依赖和可选数据源配置。FOFA Key、VPS 与其它外部基础设施均不是通用前提；不得为未支持的反弹 Shell、隧道或目标侧部署流程索取配置。返回可用/缺失状态，不下载或安装工具。

参数：
- `include` — 只检查这些技能（逗号分隔）；省略则检查全部红队技能

### `redteam_roles`
列出兼容角色标题。当前仅 recon / assess / vuln-scan 可承担被动资料整理、资产复核和漏洞情报比对；exploit / internal 角色停用，不得派发或执行。

### `redteam_role_prompt`
只读查看角色提示词。exploit / internal 当前停用：返回 enabled=false、prompt=null，不向模型暴露旧执行指令。其它角色提示词也不授予工具执行权限。

参数：
- `engagement`
- `role`

### `redteam_role_prompt_reset`
把角色系统提示词恢复为内置默认（新版模板）。老靶标想用上最新版角色提示词时用它；省略 role 则四个角色全部重置。

参数：
- `engagement`
- `role`

## B. 资产测绘（recon / assess 用）

_每条资产必须带 provenance（passive/active）与 tool；assess 阶段用 asset_assess 打 priority/potential/reason。_

### `redteam_asset_batch`

【本机批量资产 / 批量评估】复用上游 `redteam_batch` 的独有 `kind=assets|assess` 用途，但不照搬其直接批量漏洞写入或请求证据副作用。本工具不联网、不扫描、不创建已确认漏洞，也不写分数。

参数：
- `engagement` — 可选，默认会话绑定的演练
- `kind` — `assets`（默认，兼容已有用法）或 `assess`
- `items` — `assets`：1–500 条已获取的 IPv4 资产，需 `ip` 与 `provenance=active|passive`，可带 `names`、`ports`、发现时间；`assess`：1–200 条**已有资产**，每条 `asset_id` 或 `ip`、必填 `priority=high|medium|low` 和非空 `reason`，可选 `potential`、`assessed_by`
- `commit` — 默认 false，仅预览数量、拒绝原因与最多十条示例；`true` 才写入数据库
- `confirm` — 演练没有登记允许的 scope 时，实际 `commit=true` 还需显式确认；已登记范围内对每条资产 IP 核对，超出范围跳过

`assets` 复用既有 `store.importBundle` 的 SQLite 事务与幂等 upsert，逐条返回 `index/ip/asset_id`，重复提交不会重复建资产或覆盖首次发现时间。同批重复 IP 作为 `duplicate_in_batch` 拒绝。

`assess` 先只读解析现有资产并核对身份、scope、字段，再逐条调用已有 `store.assessAsset` 更新优先级与理由；不存在的资产拒绝，不创建新资产。`results` 返回原始下标与资产 ID；**逐项提交可能部分成功，并非整批原子事务**，返回 `assessed/rejected/partial`，不可将被拒绝的条目计作已评估。评估只是人工判断，不是漏洞验证。

源码来源：[接手版上游 redteam_batch](https://github.com/CallMeGuLab/dsh-purge-safe/blob/29bf73a962891cc2c543077572ebd70078897d69/lib/redteam/tools.js)（Apache-2.0）。只保留实际有价值的批量已知资产操作，HTTP 请求/响应及确认漏洞仍走已有独立证据接口。

### `redteam_asset_add`
把一个资产及其端口/服务/指纹写入资产库（幂等 upsert）。每条发现必须标注 provenance：被动收集填 passive，主动探测填 active，并填写 tool（数据源或工具名）。

参数：
- `engagement` — 靶标 id；省略则用当前会话绑定的靶标
- `ip` — 资产 IP（IPv4）
- `state` — live | dead | unknown，默认 unknown
- `primary_name` — 主域名/主机名
- `provenance` — 本条发现的来源：被动或主动
- `tool` — 数据源或工具名，例如 crt.sh / nmap / nuclei / curl
- `discovered_at` — 【可选】这条资产的发现时间（ISO，如 2026-09-17T09:30:00Z）。不填则按"第一次入库的时刻"自动记录；数据源给出历史首次出现时间时传进来更准。**重复采集不会覆盖它**。
- `first_seen` — 【可选】数据源/工具报告的首次出现时间（与发现时间分开记）
- `properties` — domain | hostname | cert_cn，默认 domain
- `port`
- `proto` — tcp（默认）| udp
- `service` — 服务名，例如 http / mysql
- `product` — 产品名，例如 nginx
- `version` — 版本，例如 1.24.0
- `banner` — 原始 banner 片段
- `url` — Web 服务可直接访问的完整 URL，例如 https://oa.example.com:8443/portal
- `title` — Web 页面标题（HTTP 探测获取），例如「致远OA 登录」
- `provenance`
- `tool`
- `properties` — Web服务器 | 中间件 | 框架 | CMS | 数据库 | VPN网关 …

### `redteam_local_asset_search`

【本地 FOFA 风格资产检索】只读取当前工作区 SQLite 中已采集的资产、域名、开放端口、网页标题、URL、服务、版本指纹，以及已保存的证书观察信息。**不调用 FOFA API、不需要 Key，不联网，不发起扫描**。同时提供「资源 → 本地测绘」界面进行条件查询。

示例：
- `domain="example.org" && port=443` — 已保存域名中包含 example.org 且 443 端口为 open
- `title="登录" || product="nginx"` — 已保存的页面标题或产品名
- `(service=http || port=8080) && scope=internal` — 已登记的内网服务
- `cert="Example CA"` — 仅匹配已保存的证书观察值与 TLS 指纹描述

支持字段：`domain`、`host`、`ip`、`port`、`title`、`banner`、`url`、`service`、`product`、`app`、`fingerprint`、`cert`、`protocol`、`scope`、`source`。组合运算 `&&` / `AND` 优先于 `||` / `OR`，支持括号与引号。默认按最近发现排序，结果分页；使用参数化 SQL，数据来自当前项目。尚未存储网页正文、地理标签等字段时，会明确提示不支持，不会声称覆盖 FOFA 的全网数据。

### `redteam_asset_query`
检索资产库。支持按 C 段、端口、服务、指纹、来源、内外网维度（scope）、排序（sort）、关键词（全文，覆盖 IP/域名/banner/服务/指纹）过滤。返回紧凑结果，含每个资产的开放端口与指纹及内外网归属。

参数：
- `engagement`
- `cidr` — C 段，例如 203.0.113.0/24
- `port` — 开放端口
- `service` — 服务/产品名关键词，例如 nginx
- `fingerprint` — 指纹关键词，例如 Tomcat / Spring
- `provenance` — 只看被动或主动来源
- `q` — 全文检索词（空格分隔多词为 AND）
- `state`
- `scope` — 内外网维度：internal=内网/私网地址，external=互联网可达
- `sort` — 排序：priority=易打性优先（默认），todo=待测优先，ports=端口多优先，ip=按 IP
- `limit` — 返回条数上限，默认 50，最大 200

### `redteam_asset_get`
取单个资产的完整详情：全部端口与服务、指纹、采集溯源时间线、关系边。用于深入分析某个目标。

参数：
- `engagement`
- `id` — 资产 id（来自 redteam_asset_query 结果）

### `redteam_skill_search`
【离线只读】检索当前 purge 随包技能，以及按需下载到 `$DSH_HOME/redteam/external-skills/aboutsecurity/skills` 的 AboutSecurity 技能。不需要另外安装 `dsh-prompt-custom` 插件。

社区技能包也会被检索：`$DSH_HOME/redteam/external-skills/community/<pack>/skills/`；可显式执行 `node scripts/install-community-skills.mjs` 安装 Yaklang 的 `hack-skills` 与 `yak-skills`，用 `--source` 选择单包、`--update` 更新、`--home` 指定当前 DSH 主目录。不会在插件启动时自动安装，也不会覆盖随包技能。

参数：`query`（名称/主题/关键词；空值列出）、`limit`（默认 10，上限 50）。

返回稳定 `key`、名称、描述与来源，另外用 `aboutsecurity_installed` 明确该外部技能库是否已找到。没有安装外部技能时仍能搜索内置技能。

### `redteam_skill_read`

完整读取 `redteam:` Skill 后会记录当前根会话 30 分钟的执行前置凭证；被截断的正文不记为已读。Nmap/httpx 与 `redteam_passive_recon` 会在执行入口强制核验，缺少记录、换根会话或凭证过期时拒绝执行。重启后需重新读取。该凭证只证明当前会话读取过对应 Skill，不证明授权、环境可用或任务已执行。
【离线只读】根据上一步的 `key` 读取技能 Markdown 正文；不会执行技能里面的命令，也不允许任意文件路径读取。查询结果里的 `key` 是唯一入口。

参数：`key`（必填，如 `aboutsecurity:recon/passive-recon` 或 `redteam:web-injection`）、`max_chars`（默认 16000）。

AboutSecurity 下载/更新命令见 [独立集成说明](ABOUTSECURITY_INTEGRATION.md)。

### `redteam_artex_knowledge_search`
【本机只读】从 ARTEX 已安装的 `knowledge.db` 检索知识条目；与 Purge「资源 → ARTEX」复用同一检索模块。适合在核对产品、组件、CVE 或排错关键词时查阅既有记录，返回条目 ID、标题、分类、验证标记及摘要，不执行其中的脚本。

参数：
- `query` — 必填，产品 / 组件 / CVE / 技术关键词
- `limit` — 可选，默认 10、最多 30（沿用知识库检索上限）

无需先打开或绑定 DSH 靶标。支持 `ARTEX_KB_DIR`、`ARTEX_HOME/knowledge` 和默认的本机 ARTEX 知识库位置；不会复制数据库、调用 ARTEX 登录接口或自动运行测试。找不到本机知识库时返回明确的错误。返回的 `verified` 是 ARTEX 原记录的标记，不能推断当前 DSH 靶标已经验证。

### `redteam_artex_knowledge_get`
【本机只读】用上一步的知识条目 ID 读取全文和使用说明；返回文字仅作为来源资料，不触发执行，也不会创建漏洞或修改 DSH 得分。

参数：
- `id` — 必填，`redteam_artex_knowledge_search` 返回的正整数条目 ID

用户可以在智能体会话中让它先搜索、再按条目 ID 读取；但这不是自动发现或执行漏洞的功能。运行于 DSH 的宿主必须能直接访问本机 ARTEX 知识库，单纯远程部署的数据库不能凭空读取。

### `redteam_kev`
【CISA KEV 已知在野利用公告参考】读取本地 CISA 官方公告缓存，**不扫描目标、不改变资产记录或漏洞结论**。与 `redteam_cve_match` 的离线指纹候选不同：它只说明某 CVE 是否在指定时间的 KEV 公告中被收录，不意味着某台主机受影响。

参数：
- `action=status`：只读显示缓存是否可用、更新时刻、条目数量和是否超过 24 小时；缺库时明确返回 unavailable，**不会联网**。
- `action=lookup` + `cve=CVE-2021-44228`：只查本地缓存；未下载时 `known_exploited=null`，未被当前缓存收录时为 `false`，两者不能混淆。
- `action=refresh`：仅在用户明确要求更新公告时手动请求 CISA 官方 JSON，失败保留旧缓存；不会启动自动更新、下载 Nuclei 模板或执行 PoC。

公开数据源：[CISA Known Exploited Vulnerabilities Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)，使用上游 [dsh-purge-safe KEV 层](https://github.com/CallMeGuLab/dsh-purge-safe/blob/d0a9abda6e2eb020dde85b48b5727b45d26582a7/lib/redteam/kev.js) 的分层设计思路，现有知识/模板库和工具权限保持不变。

### `redteam_cve_match`
【离线只读】按现有 SQLite 资产的服务、指纹、产品与端口，或直接输入 CVE / 产品名，查找随包公开漏洞候选索引。只返回候选与原始资料链接，**不执行 PoC、不联网、不写漏洞库、不自动确认成功**。同产品命中不代表版本确实受影响。

参数：
- `asset_id` — 可选；传 `redteam_asset_query` 的资产 id 后读取现有资产详情
- `engagement` — 只有使用 `asset_id` 时才需要；可省略以继承会话绑定靶标
- `cve` — 可选，精确匹配如 `CVE-2021-44228`
- `product` / `banner` / `fingerprint` / `keyword` — 可选，附加产品、指纹或文字检索
- `port` — 观察到的端口，仅作为匹配加分，不能单独产生漏洞候选
- `limit` — 返回条数，默认 10，最多 30

示例：先 `redteam_asset_query` 找到资产 id，再 `redteam_cve_match(asset_id=12)`；没有数据库也可以 `redteam_cve_match(product="Grafana", port=3000)`。用 `redteam_poc_search` 查本地已验证 PoC / Nuclei 模板；这两套检索互补，不会相互覆盖。

### `redteam_armory_search`
【离线只读】搜索本地知识与参考资料索引，只返回分类、文件路径、行数与用途说明。payload、PoC 和字典内容仅供人工审阅，不执行其中的代码、请求、口令或命令；命中不代表当前目标存在对应漏洞。

参数：
- `kind` — `payload`（载荷库）/ `dictionary`（字典库）/ `all`（默认两者都搜）
- `query` — 关键词，如 `sql盲注`、`xss`、`子域名`、`密码`、`403绕过`、`weblogic路径`
- `limit` — 每类最多返回条数，默认 20，最多 50

示例：注入确认后 `redteam_armory_search(kind="dictionary", query="列名")` 拿列名字典继续拖库；打 WebLogic 前 `redteam_armory_search(query="weblogic 路径")` 拿专属目录字典。与 `redteam_cve_match` 串联：CVE 候选 → 按产品查 payload 与字典 → 实测记录回 `redteam_vuln_add`。

### `redteam_chain_plan`
【离线规划】从资产指纹或手动输入生成**利用计划**：CVE 候选按 severity/无认证/版本适用性排序，每条展开为带占位符命令模板的 exploit 步骤，并按攻击类型（LFI/反序列化/SQLi/RCE…）联动武器库索引给 payload 与字典。**纯规划不执行**；`verified=false` 全程，不做"已利用"断言。

参数：
- `asset_id` — 资产 id（读取 SQLite 指纹/端口）或手动输入
- `cve` / `product` / `port` / `limit` — 精确 CVE / 产品名 / 端口 / 候选数（默认 5）

示例：`redteam_chain_plan(product="WebLogic", port=7001)` → 按 critical 无认证排前的候选步骤（ysoserial 构造 + T3 发送模板 + shiro/fastjson 各自的向量模板），每步带武器库路径。执行后每步 `redteam_chain_add(tool=命令原文, result=回显)` 落库，命中 `redteam_vuln_add(status=exploited)`。

### `redteam_chain_advance`
【离线规划】推进**入侵链路**到下一阶段（recon→fingerprint→vuln_match→weaponize→exploit→post_exploit→lateral）：给出该阶段的结构化步骤建议；`fingerprint` 之后自动把观测喂给 vuln_match 生成计划。**阻断不终止**——无凭据/需交互/超范围/WAF 拦截时转为 blocked 步骤并给占位符工作流，链路保持可推进形态。

参数：
- `stage` — 当前所处阶段（推进到下一阶段）
- `asset_id` / `product` / `port` — 观测输入
- `blockers` — 已知阻断 `[{reason, detail}]`：`no-credentials / network-unreachable / waf-blocked / needs-interaction / version-mismatch / out-of-scope / tool-missing / evidence-missing`

示例：`redteam_chain_advance(stage="fingerprint", product="Grafana", port=3000)` → 下一阶段 vuln_match 的候选计划；`stage="exploit", blockers=[{reason:"no-credentials"}]` → post_exploit 清单 + 无凭据阻断的占位符降级步骤。与 `redteam_attack_chain`（已发生步骤的五阶段计分视图）互补：advance 管"接下来做什么"，attack_chain 管"已经做到哪"。

### `redteam_data_quality`
只读核对资产库记录的完整性：区分候选漏洞缺证据与已确认/利用记录缺证据，统计 HTTP 请求/响应为空，以及漏洞、HTTP 证据、截图中的资产/漏洞孤立引用。只返回汇总数量，不返回原始证据或凭据，不迁移数据库，也不把记录完整当成漏洞已验证。

参数：`engagement`（可选；省略时继承当前或父会话靶标）。输出 `quality.status`、`quality.totals`、`quality.counts`、`quality.issues`。

### `redteam_asset_stats`
资产测绘概览：C 段数、资产数（存活）、开放端口、服务、指纹、被动/主动溯源条数，以及各 C 段的明细。

参数：
- `engagement`

### `redteam_asset_timeline`
资产「发现时间」视图：按天聚合"哪天收了多少资产"（区分内网/外网），并列出最近发现的资产。用于回答"这个资产是什么时候发现的"、检查信息收集有没有断层，也用于本轮收集的收口核对。

参数：
- `engagement`
- `limit` — 最近资产条数，默认 50

### `redteam_asset_graph`
导出资产图谱（C 段 → 资产 → 开放端口，含域名解析边），用于拓扑推理与横向移动路径规划。节点数超过上限时按 C 段缩小范围。

参数：
- `engagement`
- `cidr` — 只取某个 C 段的子图
- `maxNodes` — 节点上限，默认 300

### `redteam_asset_link`
在资产库中写入一条关系边（图谱与后续横向分析共用）。relation 例如 resolves / exposes / contains / trusts / shares_cert。

参数：
- `engagement`
- `src_kind` — segment | asset | domain | port …
- `src_id`
- `dst_kind`
- `dst_id`
- `relation`
- `confidence`

### `redteam_asset_assess`
给资产做「易打性评估」：预期能拿下哪些成果（账号权限/RCE/服务器权限/数据库权限/敏感数据/边界突破）、优先级多高、判断理由。信息收集收口时对每个资产调用一次，供指挥者按性价比排序。

参数：
- `engagement`
- `asset_id`
- `ip`
- `priority` — high 容易出成果 / medium 一般 / low 难打或价值低
- `potential` — 预期成果，如「账号权限+RCE」「数据库权限」「大量敏感信息」
- `reason` — 判断理由：指纹版本命中 Nday、接口未鉴权、口令弱、暴露数据库、WAF 强弱等
- `assessed_by`

### `redteam_coverage`

【离线逐项检查清单】选择性吸收接手版的 `redteam_asset/asset_next` 与 `redteam_host/hostNextActions` 核心价值：**检查项有明确状态、未完成不能收口、可查看待核队列**。我们仍使用原有 `redteam_asset_test` 表示测试过程与 WAF 状态、`redteam_next_action` 表示任务优先级；本工具不重复替代它们。

- `engagement` — 默认为会话绑定的演练；每个演练在自己的 SQLite 内保存记录
- `phase` — `external` 外部资产（`surface/web/auth/cve/app`），或 `internal` 主机检查（`files/privesc/web/db/lateral`）
- `action=status` + `asset_id` — 只读查看五项状态、缺项、人工备注和能否收口；**不会因为已有扫描/测试/得分而自动标记已完成**
- `action=update` + `asset_id` + `updates` — 一次明确更新 1–5 项，格式 `[{"field":"web","state":"done"}]`；状态为 `untested|partial|done|blocked|not_applicable`，可额外填 `note`（最大 2000 字符）。已关闭的清单再次编辑会重新开放，避免陈旧“已完成”。也支持只更新备注
- `action=close` + `asset_id` + `status=closed|blocked` — `closed` 要求五项全部为 `done|blocked|not_applicable`，否则返回缺项且不写入；`blocked` 必须填写非空 `reason`，表示被阻塞而不是已完成
- `action=queue` + 可选 `asset_id`、`limit=1..30` — 只读返回未关闭清单及各项缺口，默认按现有优先级排序；只显示相应内外网资产，不调用扫描器、不创建 Agent 任务。超过 2000 条样本显示 `partial=true`，不可将样本待核数量当成全库总数

**结构化主机发现（本轮补齐上游 `redteam_host(op=finding)` 的独有能力）：**
- `phase=internal` + `action=finding` + `asset_id` + `kind` + `title`：记录已观察到的主机元数据。`kind` 支持 `file/credential/privesc/lateral/web/db/config/share`；可填 `detail`（不含明文凭据、令牌、私钥或原始 HTTP 报文）。
- 可选 `evidence_kind` + `evidence_id` 成对填写：只接受本次演练**同一资产**里已存在的 `http_evidence`（含经 `vuln_id` 关联的资产）、`attack_step`、`access_session` 或 `vuln` 记录。引用无效、对象不存在或归属不一致一律拒绝入库。仅有引用不代表漏洞已证实。
- `phase=internal` + `action=findings` + `asset_id`：离线只读列出最近的 20 条记录（`limit` 最多 100），报告真实 `total/partial`；`redteam_asset_get` 的资产详情也包含 `host_findings`。
- 这部分**复用 `observation` 表**（`attr=host_finding`，`raw_ref=证据类型:ID`），不新增第三张数据库表、不额外注册工具，也不外传原始证据正文。发现可记录但无证据时返回 `evidence_linked=false`。
- 新增发现**不会自动更新五项检查状态、改写 `asset_test`、创建权限会话、确认漏洞或计分**，仍须人工明确核验与操作。与上游自动把检查推进 `partial` 的做法不同，这是有意保留的分离。

本仓 #496 已合并的 `redteam_asset_batch(kind=assess)` 只更新资产优先级与评估理由，**不能将其评估成功自动当作本清单检查完成**；两个功能必须分别记录。

新增的 `asset_checklist` 单表由现有 SQLite DDL 幂等建立，旧资产库加载时无须删除或改写原有 `asset.test_status/test_surface`；两种状态语义不同，绝不自动把旧的 `tested` 等同于五项全部 done。被阻塞的清单也不计 `complete`。

对照来源：[接手版 redteam asset/host coverage](https://github.com/CallMeGuLab/dsh-purge-safe/blob/29bf73a962891cc2c543077572ebd70078897d69/lib/redteam/tools.js)（Apache-2.0）。**未移植**自动主机操作、权限推断、目标探测、得分推荐或上游两套覆盖度表，以免和现有 `next_action` / Super Agent 混淆。

### `redteam_asset_test`
记录对某个资产的测试情况：本次做了什么测试（`test`，追加式）、还剩什么攻击面（`surface`，覆盖式）、当前测试状态、是否被 WAF 封禁。**每个资产开始测之前先调一次（status=testing），测完/放弃再调一次**——资产测绘页面据此显示「未测试 / 测试中 / 已测试 / 被封禁 / 已放弃 / 无攻击面」。排除结论、登录失败原因、重测理由都写在 `test` 里。

参数：
- `engagement`
- `asset_id` — 资产 id（与 ip 二选一，优先 asset_id）
- `ip` — 资产 IP
- `status` — 测试状态：未测试/测试中/已测试/被封禁/已放弃/无攻击面
- `test` — 本次做了什么测试（**追加**到测试记录，例如「nmap 全端口 + nuclei cve 模板 + 接口越权」）。排除结论、登录失败原因、重测理由都写这里。
- `notes` — test 的兼容别名（老提示词里的写法），效果与 test 相同，会一并追加到测试记录。
- `surface` — 还剩什么攻击面可测（覆盖式，例如「SMB 445 未测；Web /api 未做越权」）
- `blocked` — 本次是否被 WAF/防护封禁（true 时封禁计数 +1）
- `updated_by` — 记录角色，例如 recon / vuln-scan

### `redteam_domain_index`
按域名维度聚合资产：每个域名关联了哪些 IP/资产。用于梳理主域名、子域与 C 段的关系。

参数：
- `engagement`

### `redteam_web_list`
列出 Web 资产（含可直接访问的 URL 与页面标题）。做 Web 渗透前先看这里，优先从接口入手。

参数：
- `engagement`
- `cidr`
- `limit`

## C. 漏洞与证据（vuln-scan / exploit 用）

_confirmed/exploited 才算成果；claimed 必须用 evidence_upgrade 升级成 observed 才能进报告。_

### `redteam_vuln_add`
记录一条漏洞发现（漏洞检测角色）。带 cve 时按 (asset_id, cve, target) 幂等更新。severity：critical|high|medium|low|info；status：candidate（待验证）|confirmed（已验证）|false-positive|exploited|fixed。必须附证据（请求/响应片段、复现命令、证据文件路径）。

参数：
- `engagement`
- `asset_id` — 资产 id（来自 redteam_asset_query）
- `cve` — CVE / CNVD 编号（无编号可省略）
- `title` — 漏洞标题
- `severity`
- `status`
- `target` — 受影响的目标，如 https://host:443/path 或 ip:port
- `source` — 发现方式：nuclei / sqlmap / curl / manual …
- `confidence` — 0–1
- `evidence` — 证据：请求/响应摘要、命令、证据文件路径
- `found_by_agent` — 发现角色，默认 vuln-scan
- `gained` — 【重要】通过这个漏洞拿到了什么权限/成果，写得分口径的短标签，多项用顿号或逗号分隔，例如「服务器权限、内网隧道」「后台管理员账号」「数据库权限」

### `redteam_vuln_query`
检索漏洞库：按严重级、状态、CVE、资产、C 段或关键词过滤。用于挑选待利用目标或核对误报。

参数：
- `engagement`
- `severity`
- `status`
- `cve`
- `asset_id`
- `cidr`
- `q` — 标题/CVE/目标/证据关键词
- `limit` — 默认 50，最大 200

### `redteam_candidate_queue`
只读领取按证据准备程度分类的候选漏洞队列：ready（已有证据待核对）、needs_evidence（缺可复核证据）、needs_scope（缺资产关联）、deferred（失活或阻塞目标）。返回全量分类计数与分页后的候选 ID；不会自动确认漏洞、执行扫描或计分。

参数：
- `engagement`
- `category` — ready / needs_evidence / needs_scope / deferred，默认 ready
- `limit` — 默认 15，最大 50
- `offset` — 从 0 开始分页，返回 nextOffset

### `redteam_vuln_update`
更新漏洞状态/严重级/证据（例如验证后置为 confirmed、利用成功后置为 exploited、误报置为 false-positive）。

参数：
- `engagement`
- `id` — 漏洞 id
- `status`
- `severity`
- `evidence`
- `confidence`
- `gained` — 通过这个漏洞拿到了什么权限/成果（得分口径短标签，多项用顿号分隔）
- `title`

### `redteam_http_evidence_add`
保存一条 HTTP 证据：原始请求与响应。报告会把它渲染成可粘贴进 Burp Suite / Yakit 的原始报文，因此 request 必须是完整可重放的原始请求（含请求行、Host 等头部、必要时 body）。

参数：
- `engagement`
- `vuln_id` — 关联的漏洞 id（建议填）
- `asset_id`
- `label` — 这条证据的用途，例如「越权读取用户列表」
- `method` — GET/POST/…
- `url`
- `status` — 响应状态码
- `request` — 原始请求全文（Burp 可直接粘贴）
- `response` — 响应全文或关键片段
- `note`
- `captured_by` — 采集角色

### `redteam_evidence_record`
记录一条作战证据。核心纪律：confidence 必须如实填写——claimed（子智能体口头报告，禁止直接采信）/ observed（你亲自核实过）/ derived（从 observed 推理）/ inferred（推测，必须标注）。ev_id 由内容哈希生成，改一字就变，落库后可防篡改核对。相关技能：evidence-discipline。

参数：
- `engagement`
- `operation` — 操作名，如 "nmap_scan"、"webshell_established"、"sql_injection_confirmed"
- `parameters` — 调用参数（JSON 对象，会参与哈希）
- `result` — 规范化结果（JSON 对象，会参与哈希）
- `confidence` — claimed | observed | derived | inferred，默认 observed
- `authority` — tool-output | database-record | screenshot | request-replay | subagent-report | operator-input，默认 tool-output
- `limitations` — 局限性说明，如 ["只扫了 Top1000 端口"]
- `supporting_ev_ids` — 支撑这条证据的其他 ev_id
- `source_agent` — 哪个子智能体产出的（claimed 时必填）

### `redteam_evidence_list`
列出证据账本条目，可按 operation / confidence 过滤。汇报前先确认没有未升级的 claimed。

参数：
- `engagement`
- `operation`
- `confidence` — claimed | observed | derived | inferred
- `limit`
- `offset`

### `redteam_data_proof`
结构化记录数据暴露事实，仅保存目标、来源、接口标识、字段名、记录条数、样本检查数量和脱敏证据引用。工具不接收或保存原始样本行、原始查询、请求正文、凭据或个人数据值；`sample_count` 只表示检查过几行，样本值不入库。

参数：
- `engagement`
- `op` — add | list
- `target` 或 `asset_id` — 至少提供一个
- `source` — api | db | file | backup | other
- `interface` — 接口路径、表名或文件路径
- `fields` — 1–32 个字段名，不得填写字段值
- `row_count` — 非负整数
- `sample_count` — 0–3，仅数量
- `evidence_ref` — 已脱敏证据路径或 ID
- `pii_type` — pii | three_elements | financial | credential | other
- `vuln_id`、`note`、`limit`

它不会自动确认漏洞等级或记分。当前 `score-rules.js` 中 100 万行只是量级粗筛；G5 正式门槛仍按规则文件中的超 1 亿条或 10TB 判断，不得把上游旧实现的 1 万条标记直接当作得分门槛。

旧版上游数据库可能仍有 `sample` / `query` 历史列及旧值；当前工具和报告不会读取或返回这些列，但不会自动删除历史数据。分享或导出旧数据库前，应单独检查并脱敏历史记录。
### `redteam_cleanup`
清理台账只登记本次演练创建的临时资源，不执行删除、禁用、关闭或远程清理。交付前检查 open 项；用户明确要求保留的资源标记为 kept 并写明原因。`done` 表示操作者已确认清理完成，不代表工具执行过清理。不要记录口令、令牌、私钥、Cookie 或其他秘密值。

参数：
- `engagement`
- `op` — add | list | update
- `id` — op=update 的台账 id
- `kind` — webshell | account | tunnel | file | task | ssh_key | other
- `target` — 资源所属主机、资产或目标
- `location` — URL / 路径 / 主机:端口
- `detail` — 脱敏说明、清理方式或保留原因
- `status` — open | done | kept；list 另支持 all，默认只列 open
- `limit` — list 默认 100，最多 500

### `redteam_evidence_upgrade`
把 claimed / inferred 升级为 observed。必须带 verified_result（亲自验证的回显/数据）。

参数：
- `engagement`
- `claimed_ev_id` — 要升级的证据 ID
- `verified_result` — 亲自验证后的实际结果
- `verified_by` — 谁核实的，默认 coordinator

### `redteam_evidence_verify`
核对子智能体回报与证据账本是否一致（hash 级核对）。matched=false 表示子智能体改口、夸大或库里没有。

参数：
- `engagement`
- `operation`
- `parameters`
- `result`
- `confidence`
- `authority`
- `limitations`
- `supporting_ev_ids`

### `redteam_unverified_count`
当前靶标还有多少条 claimed/inferred 没有闭环核实。返回 >0 时汇报必须提醒未核实条数。

参数：
- `engagement`

## D. 权限与入口（exploit / internal 用）

_隧道必须写 entry_kind（target-http / target-outbound / target-agent）；只在自己 VPS 上开的不算突破。马必须冰蝎/哥斯拉。_

### `redteam_webshell_add`
登记一个已上线的 WebShell。**必须上传冰蝎马（behinder）或哥斯拉马（godzilla）的加密马**——用户在控制台要用对应客户端直连，一句话马/自研马/MemShell 用户连不上，不算可交付的入口。shell_type 只能填 godzilla | behinder；确实只能用其它形式时填 other 并在 note 里写清为什么。同一 url+pass_key 重复登记会合并刷新。登记后所有角色智能体都能复用它，不要重复打点。

参数：
- `engagement`
- `url` — WebShell 完整 URL
- `shell_type` — godzilla（哥斯拉）| behinder（冰蝎）；其它形式才用 antsword/other 并说明原因
- `pass_key` — 连接密码 / 密钥（冰蝎马写 pass，哥斯拉写 key）
- `privilege` — 当前权限，例如 www-data / root / iis
- `secret_ref` — 凭据/证据引用，例如 runs/ws-10.0.0.5.txt（不要把明文口令写进库）
- `asset_id`
- `note`
- `found_by_agent`

### `redteam_webshell_list`
列出已登记的 WebShell（含在线状态与最后检查时间）。

参数：
- `engagement`
- `status` — online | offline | unknown
- `asset_id`

### `redteam_webshell_update`
更新 WebShell 状态（被删/掉线/权限变化）或补充说明。

参数：
- `engagement`
- `id` — WebShell 记录 id
- `status` — online | offline | dead | unknown
- `privilege`
- `note`
- `check_note`

### `redteam_tunnel_add`
登记一条内网隧道。**打进内网必须先用技能 suo5-tunnel 通过 WebShell/HTTP 建 socks5（kind=suo5）**；没有隧道就不要手搓内网探测脚本。listen 写本机可用地址（如 127.0.0.1:1080），reach 写它能到达的网段。登记后扫描器可直接 -socks5 <listen>。 **红线：自己的 VPS / 自己配置的服务器不算隧道。** 只在你自己服务器上开的 socks5、frp 服务端、代理，没有碰到目标，**不算跨越靶标边界、不算边界突破或内网突破**（这类填 entry_kind=self-only，会被标成"不算突破"）。**必须说清目标侧的那一端**： · target-outbound — 目标主动连出到我方（**自己服务器收目标反弹 shell**、目标上跑 frp/Stowaway 客户端）； · target-http — 经目标 WebShell/HTTP 通道（suo5、Neo-ReGeorg、reGeorg）； · target-agent — 经目标已控进程/会话转发（SSH -R 由目标发起等）。

参数：
- `engagement`
- `kind` — suo5（首选，走 WebShell/HTTP）| socks5 | ssh-r | frp | chisel | other
- `listen` — 本地监听地址 host:port
- `entry` — 入口：WebShell URL / 跳板机 / 命令
- `reach` — 可达网段，例如 10.0.0.0/8
- `entry_kind` — 【重要】通道的目标侧那一端是什么：target-outbound（目标反弹 shell 到我方/目标上跑 frp 客户端）| target-http（经目标 WebShell 的 suo5/Neo-ReGeorg）| target-agent（经目标已控进程转发）| self-only（只在自己 VPS/自建服务器上，**不算突破**）
- `webshell_id` — 由哪个 WebShell 建立
- `asset_id`
- `command` — 建立命令，便于重建
- `pid`
- `note`
- `found_by_agent`

### `redteam_tunnel_list`
列出已登记的内网隧道（含状态、监听地址、可达网段、entry_kind 与 legit 判定）。**legit=false 表示只在自己 VPS/自建服务器上开的通道，不算跨越靶标边界、不算突破**；legit=null 表示未声明 entry_kind。

参数：
- `engagement`
- `status` — active | down | unknown

### `redteam_tunnel_update`
更新隧道状态（关闭/失效/更换监听地址）或补 entry_kind 判定。用完隧道务必标为 down 并说明，避免后续误用。**老记录没声明入口归属的（legit=null，界面显示"待确认"），用 entry_kind 补上目标侧那一端**，补完才算突破凭证。

参数：
- `engagement`
- `id`
- `status` — active | down | closed | unknown
- `listen`
- `reach`
- `entry` — 入口：WebShell URL / 跳板机 / 命令
- `entry_kind` — 补声明目标侧那一端：target-outbound | target-http | target-agent | self-only（只在自己服务器上，不算突破）
- `note`
- `check_note`

### `redteam_credential_add`
历史兼容字段：当前执行契约不采集、不复用目标凭据。不要把密码、Token、私钥或连接串写入 secret_value；既有记录仅按最小权限和本地保密要求管理，不向模型或报告输出明文。

参数：
- `engagement`
- `host` — 所属主机（IP 或域名）
- `username`
- `secret_type` — password | hash | key | token | connection-string，默认 password
- `secret_value` — 【必填】凭据明文：口令 / Hash / 私钥 / Token / 连接串
- `secret_ref` — 证据引用路径，例如 runs/cred-vnc-10.0.0.5.txt
- `privilege` — 该凭据的权限级别，如 admin / user / db-read
- `asset_id`
- `source` — 来源：exploit / dump / config-leak …
- `tool`
- `note`
- `found_by_agent`

### `redteam_credential_list`
列出已收集的凭据（含明文 secret_value），用于凭据复用与横向移动。

参数：
- `engagement`
- `host`
- `username`

### `redteam_access_add`
记录一次成功获得的访问会话（横向移动起点）。method 例如 vnc/rdp/ssh/web-shell/webshell/db；privilege 例如 admin/user/system。

参数：
- `engagement`
- `host`
- `username`
- `method` — 获得访问的方式
- `privilege`
- `asset_id`
- `session_ref` — 会话/证据引用，例如 runs/session-vnc-10.0.0.5.md
- `note`
- `found_by_agent`

### `redteam_access_list`
列出已获得的访问会话。

参数：
- `engagement`
- `host`

### `redteam_session_check`
实测所有 WebShell 与隧道的连通性（由 host 侧真实发起 HTTP / TCP 连接），并把在线/离线状态回写数据库。开工前和长时间任务后各跑一次。

参数：
- `engagement`
- `timeoutMs` — 单次探测超时，默认 6000ms

### `redteam_sessions`
【每次决策前后都要看】一屏总览当前所有可复用入口：已上线的 WebShell、可用的内网隧道（含监听地址与可达网段）、凭据、访问会话，并给出在线/离线统计。打内网前先看这里，不要重复造轮子，也不要忘记已有的隧道。

参数：
- `engagement`

## E. 攻击链与得分（全程都在写）

_每步都要写 tool（命令原文）与 result（回显），否则报告无法复现；得分点 code 先用 score_list 查。_

### `redteam_http_evidence_query`
按 HTTP 证据 ID、关联漏洞或资产 ID 查询原始 HTTP 证据。列表默认仅返回摘要、是否有请求/响应、文本长度和分页信息；指定证据 `id` 时默认返回单条完整内容（请求和响应各限制 60000 字符）。这是 `redteam_http_evidence_add` 的只读配套工具，和哈希证据账本 `redteam_evidence_list` 是两类记录。

参数：
- `engagement`
- `id` — HTTP 证据条目 ID（指定时默认 full）
- `vuln_id` — 关联漏洞 ID
- `asset_id` — 关联资产 ID
- `detail` — summary / full（full 需要具体 id）
- `limit` — 默认 20，最大 100
- `offset` — 从 0 开始分页

### `redteam_chain_add`
记录一个攻击链步骤。**报告里「这一步怎么来的」完全靠这条记录**：账号密码怎么来的、冰蝎马怎么上的、隧道怎么搭的，都要在这里用 `tool`（实际命令原文）+ `detail`（为什么这么做、线索从哪来）+ `result`（实际回显/结果）写清楚。攻击链页面与报告按 seq 排序展示。

参数：
- `engagement`
- `stage` — 动作类型（兼容字段）：recon 信息收集 | vuln 漏洞发现 | exploit 利用 | access 获得权限 | pivot 内网突破 | data 敏感数据 | other。**阶段归属用 stage_code**，这个字段只用于老数据兜底。
- `title` — 一句话描述这一步做了什么，例如「通过后台模板上传点上传冰蝎马」「用 suo5 建 socks5 隧道」
- `detail` — 为什么这么做、线索从哪来，例如「登录页泄露版本 Coremail XT 5.0 → 匹配 CVE-2023-xxxx → 后台模板管理可上传」
- `tool` — 【报告复现的关键】**实际执行的命令原文**，例如 `nuclei -t CVE-2021-xxxx.yaml -u http://x`、`suo5-linux-amd64 -t http://x/shell.jsp -l 1080`、`sqlmap -u "http://x?id=1" --dump`。不写这条，报告里这一步就没法复现。
- `result` — 【报告复现的关键】实际结果/回显摘要，例如 `uid=0(root) gid=0(root)`、「返回 200，含 1.2 万条用户数据」、「后台管理员 tomcat 登录成功」
- `asset_id`
- `vuln_id`
- `access_id`
- `evidence_ref` — 证据文件/会话引用，例如 runs/session-vnc.md
- `recorded_by`
- `point_code` — 【这一步拿了分就填】得分点 code（如 rce / webshell / boundary），服务端会自动记一次分并把步骤与得分互相挂上。**必须同时给 evidence，否则不会记分**（步骤照常入库）。
- `stage_code` — 所属作战阶段（只有这 5 个合法值）：recon(信息收集) | internet(互联网资产权限) | boundary(边界突破·搭隧道) | internal(内网资产权限) | target(靶标系统权限)。写别的值（如外部工具常见的 external/foothold/tunnel/privilege）会被忽略并退回按 stage 兜底，步骤就不落在任何阶段。
- `evidence` — 配合 point_code 使用：这一分拿到了什么（目标资产 + 账号/权限/数据量）——**不填就不记分**。
- `self_created` — 配合 point_code 使用：这一步拿到的账号/权限是**自己注册/自建**的吗？是则 true（只留过程，不计分）
- `target` — 配合 point_code 使用：目标资产
- `seq` — 不填则自动追加到链尾

### `redteam_chain`
读取完整攻击链（按步骤顺序），用于汇报与检查链路是否闭合（入口 → 权限 → 内网突破）。

参数：
- `engagement`

### `redteam_attack_chain`
攻击链：按攻击面位置串起来的五个阶段 —— ① 信息收集（互联网侧）→ ② 互联网资产权限 → ③ 边界突破（搭隧道）→ ④ 内网资产权限 → ⑤ 靶标权限。返回每阶段的阶段目标、**实际拿到多少分与累计分**、涉及资产、以及边界突破阶段的真实隧道。开工时看它明确"现在在第几阶段、下一步该打哪一阶段"，汇报时按阶段给结论。

参数：
- `engagement`

### `redteam_attack_path`
导出攻击图谱：资产拓扑 + 漏洞节点 + 已控制资产（meta.owned）。用于横向移动路径规划与战果汇报。节点过多时用 cidr 缩小范围。

参数：
- `engagement`
- `cidr`
- `maxNodes` — 默认 400

### `redteam_score_list`
查看得分目标面板：所有得分点（名称/分类/分值/是否已拿下/命中证据）与总分进度。**每次规划下一步之前先看这里**，按分值高低决定先打什么。

参数：
- `engagement`

### `redteam_score_hit`
记录一次得分。得分规则已按《突破入侵类得分规则（合并版）》重构为 **25 项**（一、获取权限 21 项 + 二、突破网络边界 4 项，共 8 个类别），另有 8 条通用规则 G1–G8 横切全部条目。**记分前先用 `redteam_score_list` 读实际 code 与该条的上限/口径**，不要凭记忆写。 **证据只写结果**：目标资产 + 拿到了什么（账号/密码/权限/数据量），不要写取得过程与路径——过程由攻击得分链路的步骤负责。能指向"用哪个漏洞拿到的"时带上 vuln_id，报告会自动附上该漏洞的原始请求。 **多档条目用 `points` 指定本档分值**：《合并版》把同一项的多个档位并成一条（如「服务器主机权限」普通 10 / 管理员 50、「域名控制权限」一级 50 / 二级 20、「网络设备权限」普通 100 / 管理员 200）。记分时把 `points` 填成本次实际档位的分值；不填就用该条的主档默认值。**同一系统只按最高权限计一次**（G1）——先记了普通档、后来提权到管理员档，再记一条管理员档（points 填高档值），系统会自动顶掉普通档那条。 **红线一：账号类得分必须先实测能登录。** 拿到账号/口令后要用浏览器（browser-automation / kimi-webbridge）或等价会话实测登录成功、能交互访问页面，才记账号权限分——**只有凭据不算拿到账号**；登不进去的写进 redteam_asset_test 的 `test` 参数。 **红线二：自己注册的账号不算得分权限。** 自助注册、自己新建的用户/角色/后台账号、自己给自己开的权限都不算——演练得分针对**拿到别人已有的**账号与权限。这类用 self_created=true 记录（留过程），不计分、不计数、不进报告。 **红线三：注意该条的计分口径（G1/G3）。** 每条得分点自带口径：`同一系统只算最高权限一次`／`同一服务只算最高一条`／`整个目标只算一次`（突破网络边界）／`按台·卡·个累加`（终端、云节点、算力卡）。且每条有自己的**上限**（如服务器主机 600 分、Web 应用 2000 分、集权系统 4000 分），到上限后同条不再累计（G3）——返回里会用 warning 告诉你"已达上限/已被顶掉"，把它当**停止信号**，换别的条目或别的资产推进，不要在同一条上刷。 **数据成果单独计分（G2）**：邮件数据、业务数据、数据资产等按重要程度另行记录，不与权限分混算；evidence 必须写出**实际数据量**（如「导出 1,320,000 条用户数据」）。

参数：
- `engagement`
- `code` — 得分点 code（或 point_id / point_name 任选其一）；先用 redteam_score_list 核对实际 code
- `point_id`
- `point_name`
- `points` — 【多档条目必填】本次命中按哪一档计分（如服务器主机权限：普通权限填 10、管理员填 50；域名控制：一级 50、二级 20）。不填则用该条主档默认值。
- `target` — 目标资产：URL / ip:port / 主机名（**带上端口**，服务/系统口径按它判定）
- `asset_id` — 目标资产在库里的 id
- `port` — 【建议填】这条得分落在哪个端口（口径判定按「资产 + 端口」；target 里已带端口时可不填）
- `vuln_id` — 【建议填】用哪个漏洞拿到的分（报告据此附原始请求）
- `step_id` — 对应的攻击链步骤 id（可选）
- `evidence` — 【必填】结果：拿到的东西，例如「后台管理员 tomcat/Tomcat@2024（已实测浏览器可登录）」「数据库账号 root/xxx」「导出 132 万条用户数据」。多档条目请写明档位（如"管理员权限"）。
- `self_created` — 【重要】这个账号/权限是不是**自己注册、自己创建**的？是则填 true —— 只作过程记录，不计分、不进报告。拿到别人已有的账号/权限不要填（默认 false）。
- `note`
- `recorded_by`

### `redteam_score_point_save`
新增或修改得分点（分值/名称/分类/说明/启用）。用户也会在界面上编辑；智能体只在必要时用（例如发现规则里还有未被记录的得分项）。带 id 为修改，不带 id 为新增。

参数：
- `engagement`
- `id` — 已有得分点 id（修改时传）
- `name`
- `code` — 短代码（新增时建议给，便于记录得分）
- `category` — 分类，如 账号权限 / 服务器权限 / 数据库 / 网络突破 / 数据 / 核心目标
- `points` — 分值
- `description` — 得分条件说明
- `enabled`

## F. POC 与攻击文件

_跨靶标可复用的进 poc_*；只对本次有效的脚本进 attack_file_*；验证有效后回填 verified。_

### `redteam_poc_add`
把**通用可复用**的 POC/EXP 落进知识库（跨靶标共享）。从互联网拿到的、自己手搓的、或已经调通验证过的都往这里放——只收录真正有效的，并写清来源与验证证据。判断标准：**换个目标还能用**的进知识库；只对本次靶标有效的脚本走 redteam_attack_file_add（攻击文件页）。同名（同一 code）会合并刷新，可用于更新版本。 **回填三件套（缺了面板里就没有归类、追溯不到来源）**：① `category` 归类；② `engagement` + `asset_target` —— 这条知识是在哪个靶标、哪台资产上发现并验证的；③ `verified` + `verified_note` 验证证据。

参数：
- `title` — 标题：组件 + 漏洞名/编号，例如「Weblogic T3 反序列化 CVE-2023-21839」
- `kind` — poc（验证）| exp（利用）| script | template | payload
- `category` — 【归类，建议必填】rce 远程命令执行 | deserialization 反序列化 | file-upload 文件上传 getshell | sqli SQL 注入 | unauthorized 未授权访问 | auth-bypass 认证绕过/越权 | weak-password 弱口令 | ssrf | xxe | path-traversal 目录穿越/任意文件读 | info-leak 信息泄露 | privesc 提权/横向 | tunnel 隧道/代理 | other 其它
- `cve` — CVE / CNVD 编号
- `component` — 组件/产品名（便于按组件检索）
- `versions` — 影响版本范围
- `severity` — critical | high | medium | low
- `language` — python | go | java | bash | http | nuclei | js | php
- `source` — web（互联网扒的）| self（自己手搓）| manual（人工）| nuclei-template
- `source_url` — 来源链接（互联网来源必填，便于复核）
- `description` — 这个 POC 干什么、原理要点、前提条件
- `usage` — 用法：完整命令行示例 + 需要替换的参数
- `content` — 正文：脚本/POC 源码、原始请求包、nuclei 模板、调用步骤
- `path` — 也可以给本机已有文件路径（相对 pocs/ 或绝对路径），由知识库读取正文
- `filename` — 正文落盘文件名，默认按语言给（poc.py / poc.sh / poc.yaml…）
- `verified` — 是否已实测验证（**只有在真实目标上验证过的才填 true**）
- `verified_note` — 验证证据：在哪台目标、什么回显/结果、是否需要认证
- `engagement` — 【来源靶标】这条知识是在哪个靶标上发现/验证的（填靶标 id 或单位名称）
- `asset_target` — 【发现资产】具体是在哪台资产/哪个目标上验证成功的，例如 10.1.2.3:8080 或 http://oa.demo.com
- `found_by_agent` — 发现它的角色 code（recon / assess / vuln-scan / exploit / internal）
- `tags` — 逗号分隔标签，例如「java,反序列化,rce」
- `created_by` — 哪个角色/智能体沉淀的

### `redteam_poc_search`
【只读知识查询】先用 redteam_poc_search 查本地记录，再用 redteam_poc_get 阅读条目。查询结果只是研究线索；当前没有经审查的 PoC / Nuclei 执行契约，不得运行 payload、模板或远端请求。新增记录必须标注来源与验证状态，不把未验证内容写成已验证。

参数：
- `q` — 关键字：组件+版本、漏洞名、路径片段、正文里的特征串都行
- `cve` — CVE / CNVD 编号，例如 CVE-2023-21839
- `component` — 组件/产品名，例如 Weblogic、Shiro、泛微 OA、Nacos
- `kind` — poc | exp | script | template | payload
- `category` — 按**归类**筛（可多值，逗号分隔）：rce | deserialization | file-upload | sqli | unauthorized | auth-bypass | weak-password | ssrf | xxe | path-traversal | info-leak | privesc | tunnel | other
- `engagement` — 按**来源靶标**筛（靶标 id 或名称关键词）：只看"在某个单位上验证过的"经验
- `asset_target` — 按**发现资产**筛（IP / 域名 / URL 片段）
- `language` — python | go | java | bash | http | nuclei | js | php
- `source` — web（互联网）| self（手搓）| manual（人工）| nuclei-template
- `verified` — true 只看实测验证过的（优先用这些）
- `templateLimit` — 本机 nuclei 模板最多返回几条，默认 20
- `refresh_index` — 默认 false。手动运行过 nuclei 模板更新、复制/修改嵌套 YAML 以后，显式设为 true，**只重建本机检索索引**，让新增/更新的模板立即可搜索；不会联网、不下载模板、不启动扫描或修改模板内容。响应的 `local_templates.reindexed` 报告是否找到目录并重建索引。
- `limit` — 知识库条目上限，默认 200

### `redteam_poc_get`
取一条知识库 POC/EXP 的**完整内容**（正文 + 用法 + 验证记录 + 落盘路径），可直接照用或改造成目标专用脚本。不传 id 时可用 code（redteam_poc_search 返回里的 code 字段）。

参数：
- `id` — 知识库条目 id
- `code` — 知识库条目的稳定标识（search 结果里的 code）

### `redteam_poc_list`
列出知识库里的 POC/EXP（可按 kind/source/component/verified 过滤，不带条件就是全部）。用于盘点"我们手上已经有哪些现成武器"，避免重复搜集。

参数：
- `kind`
- `source`
- `component`
- `verified`
- `limit`

### `redteam_poc_update`
更新知识库条目：补验证结论（verified + verified_note）、修正影响版本、补用法或正文、改标签。**在真实目标上验证通过后，一定要回来把 verified 置 true 并写清证据**——后续智能体会优先用已验证的。

参数：
- `id` — 知识库条目 id
- `code` — 或用 code 指定条目
- `patch` — { verified, verified_note, versions, usage, description, content, tags, severity, component, cve, source, source_url, language }
- `verified` — 便捷写法：直接传 verified
- `verified_note` — 便捷写法：直接传验证证据

### `redteam_poc_use`
记一次知识库 POC/EXP 的复用（用在哪个靶标/目标）。复用次数高的条目会排前面，方便后来者优先选经过实战的武器。

参数：
- `id`
- `code`
- `used_on` — 用在哪：靶标名 / 目标 IP / URL

### `redteam_attack_file_add`
保存一个**实际生效**的攻击文件（脚本/POC/EXP/字典）到目标文件夹，供复用与交付。目录结构：attack-files/<IP|URL主机|C段>/<文件名>。evidence 必填且必须写清验证效果（例如"回显 uid=0"、"未授权返回 200 并含数据"）——**没打通的、只是尝试过的脚本不要放进来**。

参数：
- `engagement`
- `target` — 目标：IP、URL 或 C 段（同一 IP 的多个端口会归到该 IP 文件夹）
- `name` — 文件名，例如 cve-2021-22893.sh / vnc_brute.py
- `kind` — 类型：poc 验证 / exp 利用 / script 脚本 / wordlist 字典
- `description` — 这个文件做什么（一句话）
- `evidence` — 有效性证据：实际打通的输出/回显/影响，或对应漏洞/证据 id
- `content` — 文件内容（与 path 二选一）
- `path` — 已存在的文件路径（相对靶标目录或绝对路径），会复制进目标文件夹（与 content 二选一）
- `asset_id`
- `vuln_id`
- `created_by`

### `redteam_attack_file_list`
列出已保存的攻击文件（按目标文件夹分组）。开始打某个目标前先看这里，避免重复造轮子。

参数：
- `engagement`
- `target` — 只看某个目标

## G. 疑点与报告

_交付用 score_report（只收已得分项，附可重放原始请求）；report/report_targets 是旧接口。_

### `redteam_unknown_record`
记录一个还没解决的作战问题。question+domain 相同会去重。

参数：
- `engagement`
- `question`
- `severity` — low | medium | high | critical，默认 medium
- `domain` — 如 internal-recon / boundary-break / lateral-movement
- `recommended_probe` — 建议的验证手段
- `supporting_ev_ids`

### `redteam_unknown_list`
列出未解决的作战问题，派活前先看 open 项。

参数：
- `engagement`
- `status` — open | investigating | blocked | contradicted | resolved
- `severity`
- `limit`

### `redteam_unknown_resolve`
把未解决问题标为 resolved / contradicted / withdrawn。

参数：
- `engagement`
- `unk_id`
- `disposition` — resolved | contradicted | withdrawn
- `resolution` — 解决说明

### `redteam_score_report`
攻击得分链路复现报告：只收录"拿到了分"的成果（没得分的漏洞不进报告），每一项都尽量附上可直接粘贴进 Yakit Repeater 复现的原始请求。需要交付报告时用这个，而不是 redteam_report。

**新增附录 6：未核实主机发现索引。** 若当前演练通过 `redteam_coverage(phase=internal,action=finding)` 登记了主机发现，报告会单独列出最多最近 100 条的记录 ID、资产 IP、发现类别、已有证据记录引用与「未验证/未关联」状态，超出数量明确显示截断。**它们不进入得分正文、不确认漏洞、不改变总分**，只是方便报告使用者回到资产详情核对。为免人工标题/说明或原始证据正文带出敏感数据，附录**不输出**发现自由文本、请求/响应、命令、凭据；`--shareable` 导出模式还会通过已有掩码处理资产 IP。没有主机发现时不新增空附录。

实际落盘的 `scripts/export-engagement-report.mjs` 及工具的 `redteam_score_report(markdown=true)` 共用 `scoreReport` 生成的 Markdown。

参数：
- `engagement`
- `limit` — 最多多少项，默认 500
- `markdown` — true=返回 markdown 全文（默认 true）；false=只返回条目摘要

### `redteam_report`
【已弃用，改用 redteam_score_report】生成成果报告（Markdown）：只收录**已验证/已利用且中危以上**的成果漏洞（每条附可粘贴进 Burp/Yakit 的原始请求）、攻击链、已获权限与凭据、修复建议。信息收集的资产清单、待验证/误报、低危与信息级水洞都不会出现在报告里。想让发现进报告：先 redteam_vuln_update 置为 confirmed（验证通过）或 exploited（利用成功），再 redteam_http_evidence_add 补原始请求。

参数：
- `engagement`

### `redteam_report_targets`
【已弃用，改用 redteam_score_report】按目标查看成果报告（每个 IP / URL / C 段一份）：成果漏洞（含可粘贴进 Burp/Yakit 的原始请求）、已获权限、凭据、攻击文件、攻击链。用于按目标汇报或检查某个目标还缺什么。

参数：
- `engagement`
- `target` — 只看某个目标的报告

### `redteam_shot_add`
登记一张证据截图：把图片拷进靶标目录并关联到得分点/命中（面板展开得分点即可看图，报告里也会嵌入）。批量得分点（如终端权限）每个得分点最多展示 3 张代表图，不必逐台截图。

参数：
- `engagement`
- `path` — 图片在本机的路径（相对靶标目录或绝对路径）；与 data_base64 二选一
- `data_base64` — 图片内容（base64，可带 data: 前缀）；截图工具没落盘时用这个
- `label` — 图片说明，例如「域控 WEB-SHDC1 atexec 回显 nt authority\\system」
- `kind` — screenshot（现场截图，默认）| card（由记录生成的证据摘录卡，报告里会标注）
- `point_code` — 关联的得分点 code，如 terminal-access / central-system
- `hit_id` — 关联到具体某条得分命中（score_hit id）；给了它这张图就只挂在那一条上
- `asset_id`
- `target` — 这张图对应的目标（IP / URL）
- `note` — 补充说明：这张图证明了什么
- `source_ref` — 原始来源：截图的落盘路径或 runs/ 下的证据文件
- `captured_at` — 截图时间（ISO），缺省用当前时间

### `redteam_shot_list`
列出已登记的证据截图（含所属得分点、目标、类型、落盘文件）。

参数：
- `engagement`
- `point_code`
- `hit_id`
- `asset_id`

### `redteam_shot_delete`
删除一张证据截图（连同磁盘文件）。

参数：
- `engagement`
- `id` — shot id（redteam_shot_list 里返回的 id）

## 注册工具补充说明

以下工具已在 `lib/redteam/tools.js` 注册，此处补全此前遗漏的说明。

### `redteam_scan_history`

【只读扫描历史、下一步反馈与原始文件校验】查看当前项目按时间排序的扫描记录：工具、目标、运行状态、原始输出路径、摘要、导入数量及下一个建议检查动作。数据直接来自上一次 `redteam_scan_run` 保存的 manifest 文件，不额外生成数据库。

参数：
- `engagement` — 可选，默认会话绑定的项目
- `status` — 可选，筛选 `imported`、`no-findings`、`previewed`、`failed`、`timeout`、`import-failed` 等状态
- `limit` / `offset` — 分页
- `run_id` — 可选；指定时重新核对原始输出的大小与 SHA-256，返回 `verified` / `changed` / `missing`；不扫描目标，不代表扫描结果真实有效

列表同时返回 `feedback`：按同工具、完全相同目标汇总最新状态与重复次数。失败、预览、导入失败、空输出会提示先复核旧记录，不自动重试或禁用工具；成功的后续记录会覆盖同目标的旧失败提示。`redteam_next_action` 和概览页复用这些建议，同时保留漏洞/资产原有优先级。

### `redteam_passive_recon`

【被动域名情报适配器】所有操作都要求项目明确登记精确 `*.根域名` 范围；只处理该根域下的具体主机名，不把解析出的 IP 自动授权或写入资产/端口/漏洞表。

- `action=subdomains`：离线读取最近 CT 快照；可显式选择固定被动模式的 subfinder（`-d`、限时、限速、每来源结果上限，不启用 `-all` / `-active`），或 Amass `enum -passive`。每次外部数据源请求都必须先取得用户明确同意并传 `confirm_external=true`。subfinder 可在明确选择的 local/WSL/Docker/SSH Kali 环境执行；Amass 当前仅 local。输出只合并授权范围内主机名，最多 1000 项。
- `action=resolve`：只读取最近保存的子域快照，最多 200 个名称；dnsx 固定查询 A/AAAA/CNAME，使用本机配置的系统 DNS 解析器（不走 HTTP/SOCKS 代理），限速 10 qps、5 线程、单次重试。只接受已输入名称的响应，CNAME 超出授权范围时丢弃且不跟进。需要 `confirm_external=true`；当前仅 local，检测到 TUN/fake-IP 时不启动；TUN 检查通过也不证明实际出口经代理或 VPS，结果会标记为 route not verified。
- `action=history`：离线读取最近子域快照，不联网。

参数：`action`（subdomains / resolve / history）、`target`（根域名）、`engagement`、`use_subfinder`、`use_amass`、`confirm_external`、`environment_id`、`max_names`、`commit`（默认 false）。只有显式 `commit=true` 才保存快照。工具执行失败、未安装、环境不支持、无结果和模拟结果必须分别报告；不得使用通用 Shell 兜底。

禁止字典枚举、DNS 爆破、AXFR、DNS 追踪、主动端口/Web 扫描、自动范围扩张或将 DNS 答案作为漏洞/存活证明。原始命令参数由适配器固定构造，不接受任意 argv。

### `redteam_scan_run`

【主动测试执行与留证】针对单个已获授权的目标执行 Nmap 或 ProjectDiscovery httpx，原始输出与执行参数保存到当前工作区的 `scan-output/`。命令、时间、输出哈希、执行环境和解析摘要同步记录；成功后复用现有 `redteam_ingest` 将真实发现批量落库并关联扫描记录。失败或空输出不入库，不把扫描结果冒充已确认漏洞。

参数：
- `kind` — 必填：`nmap` 或 `httpx`。
- `target` — 必填：单个 IP、域名或 HTTP(S) URL。
- `engagement` — 可选：缺省使用会话已绑定的项目。
- `environment_id` — 可选：`local`（默认）、`wsl:<发行版>`、`docker:<当前运行容器 ID>` 或 `ssh:kali-vm`。远端 ID 必须来自当前环境清单/工具选择结果，不会自动切换。
- `ports` — Nmap 可选端口，例如 `80,443`。
- `commit` — 默认 `true`：导入资产/端口；`false` 仅预览但仍保留文件。
- `confirm` — 未登记授权范围时必须显式确认。

执行器仅接受固定 Nmap/httpx 参数构造器，不接受任意命令或可执行文件。远端任务会重新发现所选环境并验证工具版本；SSH 还必须通过严格主机密钥检查与 Kali 身份确认。所有环境均复用同一单目标范围门禁、超时与证据 manifest。本机、WSL、Docker 检测到 TUN 网卡或 fake-IP 时会在启动扫描器前拒绝，避免伪造端口入库；此时可用 `redteam_l7_probe` 对同一授权主机做应用层复核。SSH Kali 的远端出站路由不会由本机检测，结果会明确标注未验证。

### `redteam_ingest`
批量解析本地扫描文件，支持 nuclei、httpx、nmap、ffuf。默认只预览计数；只有 `commit: true` 才写入资产或漏洞。ffuf 仅返回路径，不会写库。

参数：`engagement`（可选）、`file`（必填）、`kind`（可选）、`commit`（默认 false）、`max`（默认 5000，上限 20000）。

### `redteam_credential_check`
对已记录或明确输入的凭据进行 TCP 连通性检查；mysql/redis 支持一次协议认证并返回错误诊断。会访问指定主机，须在允许的测试范围内使用。

参数：`engagement`、`credential_id`；或 `host`、`port`、`username`、`password`、`database`、`kind`（mysql/redis/ssh/tcp）、`timeout`。

### `redteam_score_suggest`
只读对账已确认漏洞、证据、实际成果与计分规则；`can_score` 是待复核建议，不会自动生成 `score_hit`。

参数：`engagement`、`limit`（默认 8，最多 20）。

### `redteam_scope_review`
【离线只读】保留原有库内资产审查，并选择性补齐上游 `redteam_scope_check` 的**指定目标核对**，复用当前 `targetInScope`，不发 DNS/HTTP/扫描请求；登记的 scope 不是实际授权的证明。

两种模式：
- **资产清单审查（旧模式不变）**：传 `allowed`（必填的范围字符串，逗号或换行分隔）和可选 `limit`（默认 25，最多 100），将库内资产与这份显式范围比对，显示样本数和是否仅部分覆盖
- **指定目标审查（新增）**：传 `target` 一个目标，或 `targets` 1–50 个目标（IP、域名、HTTP(S) URL），依据当前演练元数据登记的 scope 逐条核对，返回 `mode=target-check`、`in-scope`、`out-of-scope`、`unscoped` 或 `name-only`。后者仅域名匹配，`needs_ip_review=true`，不能据此确认解析 IP 属于授权网段

两种模式互斥。未登记 scope 不能悄悄算作允许；本工具既不更新 scope，也不会触发实际目标连接。

### `redteam_delivery_audit`
只读检查已记录得分的目标、证据结果与来源关联缺口；文本完整不代表漏洞已可复现，也不会自动加分。

参数：`engagement`、`limit`（默认 25，最多 100）。

### `redteam_progress_check`
只读比较前后分数、资产、漏洞、测试状态及 HTTP 证据数量，不会把变化推断成真实突破。

参数：`engagement`、`before`（必填，原样传入上次 `redteam_next_action` 的 `focus.before` JSON 字符串）、`task_key`（可选）。

### `redteam_l7_probe`
【应用层服务探针】对单个主机的指定端口做 L7 判定，**专治 TUN 类代理造成的端口伪造**。

启用 FlClash / Mihomo 等 TUN 后，隧道对任意 TCP 连接回伪造 SYN-ACK，实测出现过 `nmap --top-ports 1000` 报 **1000/1000 open、延迟 0.75ms**，连 `1.1.1.1:1`、`example.com:12345` 这类必然关闭的端口也判 open —— 此时 TCP 层 STATE 没有鉴别力。

伪造的 accept 无法完成应用层交互，所以本工具靠交互判定：先被动等 banner（SSH / FTP / SMTP / POP3 / IMAP / MySQL），无 banner 再发一次极小的 HTTP GET 与 TLS ClientHello。

- `verdict=REAL_SERVICE`：确实有服务，附 `service` 与 `evidence`（banner 或响应首行）
- `verdict=FAKE_OR_SILENT`：连接"成功"但无任何应用层响应 —— TUN 环境下假 open 的典型特征，**不要当成开放端口写进结论**
- `verdict=UNREACHABLE`：连接未建立

只做被动读与一次探测请求，不发送凭据、不尝试登录、不执行目标侧命令。走与扫描同一套范围门禁。

参数：`engagement`、`host`（必填，单个 IP 或域名）、`ports`（数组，不传则用内置高价值端口清单）、`proxy`（可选 `socks5://127.0.0.1:7890`，不传则直连）、`concurrency`（默认 4，上限 16）、`confirm`。

### `redteam_exploit_chain`
【模拟占位】历史漏洞利用链工具当前不执行目标操作。dry_run=true 仅返回不含命令的阶段标签；dry_run=false 返回 unsupported。旧参数仅为兼容保留，不会读取凭据、执行 PoC、部署 C2、建立持久化或写入执行证据。

**`dry_run` 默认 `true`**：仅返回无命令的模拟阶段标签，不访问目标、不写入攻击链；`dry_run:false` 当前返回 unsupported，不存在真实执行入口。范围文本校验仅用于本地预览，不构成执行授权。模拟结果不写入 redteam_chain_add，也不创建凭据、WebShell 或访问会话记录。

参数：`engagement`、`vuln_id`（提供时自动读取 CVE/组件/严重级与目标）、`target`、`port`、`service`（http/https/ssh/smb/winrm/db）、`os`（windows/linux）、`strategy`（`auto` 默认，按严重级与服务选择；或 `nday-first` / `spray-first` / `stealth`）、`dry_run`（默认 true）、`deploy_c2`、`persist`、`users`、`passwords`、`confirm`。

### `redteam_internal_campaign`
【模拟占位工具】当前只返回明确标记的内网作战阶段计划。底层 `InternalRecon` / `LateralExecutor` 仍含测试夹具和未实现方法，不能把其中的模拟主机、端口、凭据或成功状态当作真实发现。

- `dry_run` 默认 `true`：返回 `status=simulated`、`success=null` 和计划阶段；不访问目标、不连接隧道、不写入资产或作战成果。
- 显式 `dry_run: false`：返回 `status=unsupported`；真实执行适配器尚未实现，因此会拒绝启动。
- 内网范围校验仍在工具入口执行；登记了 scope 就必须命中，未登记则需要显式 `confirm: true`。通过范围校验不代表工具已经具备执行能力。
- 只有在真实执行适配器、隧道路由和逐项证据校验完成后，才可以恢复实际执行语义。

参数仍为兼容保留：`engagement`、`starting_host`、`tunnel_listen`、`username`、`password`、`cred_type`、`mode`、`target_network`、`exfiltrate`、`max_parallel`、`dry_run`、`confirm`。当前占位实现不会使用凭据、隧道监听地址或目标网段执行操作。

## 典型调用链

```
redteam_engagement_open          建靶标（一次演练一个）
redteam_preflight                开工前自检：技能/工具/FOFA/VPS
redteam_agent_slot acquire      占一个执行名额（≤3）
  recon      → asset_add / asset_query / domain_index / web_list
  assess     → asset_assess（priority/potential/reason）+ asset_test
  vuln-scan  → vuln_add → http_evidence_add（原始请求/响应）
  exploit    → disabled / unsupported（当前无经过审查的执行适配器）
  internal   → disabled / unsupported（当前无经过审查的内网执行适配器）
redteam_chain_add                仅用于人工核验后的历史记录；模拟/计划不得写成真实执行
redteam_evidence_upgrade         claimed → observed（核实后才算拿到）
redteam_score_report             出交付报告
```


### 作战台本机主动测绘与隐私保护状态（UI）

「管理 → 环境 → 测绘中心」除了离线筛选外，可使用本机 Nmap/httpx 对**已登记的单个授权目标**执行探测，经 `localActiveSurvey` API 复用 `scan-runner`、原始输出记录与 `importBundle`；默认为仅预览，选择入库后才写资产，结果可在历史页核验。模型既有 `redteam_scan_run` 仍保持范围校验。

「管理 → 低干扰」新增 `scanPreferences.noReverseDns` 和 `scanPreferences.maskAssetResults`：前者真实影响下一次 Nmap 命令的 `-n` 参数，后者只保护测绘中心的可视展示。 `privacyPosture` 根据已保存配置列出已经生效、可启用及目标侧日志等无法保护的项目，不能用它声称实现匿名或隐身。

Purge 的 `privacyPosture.bridge` 现在会在 Node HTTP 请求能获取所属服务器的 `server.address()` 时报告实际监听 `boundAddress`、`boundPort` 和 `listenerScope`（`loopback_bound` / `all_interfaces` / `specific_interface`），并与连接接受地址 `acceptedAddress`、`acceptedPort` 区分；无法读取时仍返回 `not_inspected`。**绑定回环地址并不保证公网不可访问**（例如反向代理、容器端口映射或隧道可转发请求），`publicReachability` 始终为 `not_tested`。本项仅做本地运行时观测，不扫描外网、不更改监听行为。

### Unified local reference library

- `redteam_knowledge_search`: browse bundled Chinese reference articles or search personal documents, CVE references, skills and local ARTEX knowledge. Results preserve source and ID; semantic mode uses only the explicitly configured local embedding service.
- `redteam_knowledge_get`: read a selected reference by source and ID. Returns bounded text and attribution; does not execute reference content or verify a target.

- Pagination: choose a specific source and pass `offset` for `bundled`, `personal`, `cve`, `redteam`, or `aboutsecurity` (20 items per page). `source=all` returns each source's first page; the ARTEX adapter has no `offset` and uses its separate search tool.


### `redteam_experience`
跨靶标经验库：自动记录扫描运行结果、资产测试结论、子 Agent 结束事件、持久任务回报和真实执行链的高层结果；失败、阻断、超时、中断、无发现与成功都会保留。相似任务通过 `redteam_task_context` 自动带出相关经验。

参数：
- `action` — 必填：`list` 查看经验，`review` 核验或否决经验
- `task_type` / `query` / `limit` — `list` 过滤条件
- `id` / `status` / `evidence_ref` / `review_note` — `review` 必填或按状态要求填写

新经验默认是 `candidate`。重复出现只增加复现次数与置信度，不会自动变成可信技能；只有核对原始证据后才能标记 `validated`。经验只提供复核线索，不自动执行任何动作，也不保存凭据、原始请求或目标地址。
