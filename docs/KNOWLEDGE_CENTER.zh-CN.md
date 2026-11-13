# Purge 个人知识库（开发阶段）

作战台 → 资源 → 知识库。无需选择靶标，创建和编辑个人技术资料，分类、标签、来源、收藏、全文关键词搜索和分页。正文按纯文本保存，可粘贴 Markdown；不执行文档内的代码。

数据位于现有 Redteam 数据根目录 knowledge/personal.db，不写 ARTEX 或漏洞事实库。现阶段使用 SQLite 字面子串检索（支持中文），不调用外部模型，不需要额外服务。后续文件导入尚未实现。

此版本处于开发分支，未发布。

## 统一检索

知识库 → 全库检索：个人资料、CVE 索引、内置技能、AboutSecurity、ARTEX。可按来源过滤、打开原文；每来源最多显示 20 条，已知总量与未知总量区分显示。技能采用目录元数据匹配，CVE 为候选资料，ARTEX 复用原有只读适配器。某来源缺失或失败时其他来源仍可用。不复制外部数据库，不执行资料中的内容。

## Agent 引用

使用 `redteam_knowledge_search(query, source)` 获取带来源与 ID 的摘要，再用 `redteam_knowledge_get(source, id)` 读取选定文档。任务上下文按已记录产品或 CVE 返回最多三条个人知识引用，默认不附正文、不修改事实库。CVE 索引位置 ID 适用于当前安装版本，跨版本引用请同时保留标题、CVE 编号与原始来源链接。Agent 资料检索不代表验证或执行。

## 本地语义检索

知识库 → 语义检索。先在 LM Studio 加载 text-embedding-nomic-embed-text-v1.5 并启动 Local Server（默认 127.0.0.1:1234）。可在宿主环境设置 PURGE_EMBEDDING_PORT / PURGE_EMBEDDING_MODEL，重启宿主生效。仅直接连接本机回环地址，不使用代理或云端回退。点击建立索引或索引本批未索引文档，显示真实索引覆盖数；编辑正文或标题、删除文档自动失效。模型或端口更换后须重新建立当前索引。检索返回相似度、片段、来源 ID，按需查看原文。Agent 可用 redteam_knowledge_search(mode=semantic) 查询已索引个人资料，不自动建立索引。外部库仍走原检索。真实 LM Studio 中文召回质量需实机验证。
