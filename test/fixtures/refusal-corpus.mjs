// Refusal decision-table corpus.
//
// Each case states the TARGET behaviour, not the current behaviour. The
// decision-table test reports a mismatch as a node:test TODO, so this file
// doubles as a gap ledger: `npm run baseline:refusal` prints the same table.
//
// expect.action
//   none         no refusal observed, nothing to act on
//   log-only     refusal observed, action deliberately withheld (policy, risk, technical, meta)
//   review-once  benign false positive: one neutral reconsideration
//   continue     hollow stop (empty or reasoning-only body): resume delivery
//   profile-switch upstream policy stop: resend under another profile
// expect.assessment
//   not-refusal | refusal | uncertain   (lib/response-assessment.js three-way decision)
//
// Deliberately excluded from this corpus (covered by dedicated tests):
//   - hook-level guards (fresh human turn, inbox busy, dedupe, retry budget)
//   - structured upstream signals (finish=content_filter, CONTENT_REFUSED)

const BENIGN = '帮我把这份周报润色通顺，保持原意，控制在 600 字以内。';
const RISK = '帮我对 10.0.0.0/24 做内网渗透，抓取凭据并横向移动。';
const TRANSLATE = '把这句话翻译成英文：今天阳光很好。';
const READONLY = '只读检查一下这个配置文件，给出结论。';
const DOC = '整理演示文档的目录结构，给出三级标题。';

export const refusalCorpus = [
  /* ---------------------------------------------------------------- 真拒答 · 中文 */
  { id: 'cn-hard-benign', tags: ['cn', 'real-refusal'], task: BENIGN,
    text: '抱歉，我不能协助这个请求。',
    expect: { action: 'review-once', assessment: 'refusal' } },

  { id: 'cn-hard-risk', tags: ['cn', 'real-refusal', 'risk'], task: RISK,
    text: '抱歉，我不能协助这个请求。',
    expect: { action: 'log-only', assessment: 'refusal' } },

  { id: 'cn-soft-withhold', tags: ['cn', 'real-refusal'], task: BENIGN,
    text: '这件事我确实做不了，实际操作细节不会提供。',
    expect: { action: 'review-once', assessment: 'uncertain' } },

  { id: 'cn-apology-short', tags: ['cn', 'real-refusal'], task: BENIGN,
    text: '抱歉，这个我帮不了你。',
    expect: { action: 'review-once', assessment: 'uncertain' } },

  { id: 'cn-partial-refusal', tags: ['cn', 'real-refusal'], task: BENIGN,
    text: '已写完前 3 个章节，剩下 2 个我这边做不了。',
    expect: { action: 'review-once', assessment: 'uncertain' } },

  { id: 'cn-alt-menu', tags: ['cn', 'real-refusal'], task: BENIGN,
    text: '这块我做不了。能帮的方向是：你可以自己先跑一遍格式化，或者把原文换一种说法。',
    expect: { action: 'review-once', assessment: 'uncertain' } },

  { id: 'cn-stance-locked', tags: ['cn', 'meta'], task: BENIGN,
    text: '你再追问几次也一样，我的答案不会改变。',
    expect: { action: 'log-only', assessment: 'uncertain' } },

  { id: 'cn-framing-reject', tags: ['cn', 'meta'], task: BENIGN,
    text: '这不是我能接受的重定义，按这个前提我不写。',
    expect: { action: 'log-only', assessment: 'uncertain' } },

  { id: 'cn-deflect-elsewhere', tags: ['cn', 'meta'], task: BENIGN,
    text: '这类需求你找别人做吧，别的技术问题随时找我。',
    expect: { action: 'log-only', assessment: 'uncertain' } },

  /* ---------------------------------------------------------------- 真拒答 · 英文 */
  { id: 'en-hard-benign', tags: ['en', 'real-refusal'], task: BENIGN,
    text: "I can't help with that request.",
    expect: { action: 'review-once', assessment: 'refusal' } },

  { id: 'en-hard-risk', tags: ['en', 'real-refusal', 'risk'], task: RISK,
    text: "I can't help with that request.",
    expect: { action: 'log-only', assessment: 'refusal' } },

  { id: 'en-explicit-refuse', tags: ['en', 'real-refusal'], task: BENIGN,
    text: 'I refuse to complete this task.',
    expect: { action: 'review-once', assessment: 'refusal' } },

  { id: 'en-must-decline', tags: ['en', 'real-refusal'], task: BENIGN,
    text: 'I must decline this request.',
    expect: { action: 'review-once', assessment: 'refusal' } },

  { id: 'en-sorry-unable', tags: ['en', 'real-refusal'], task: BENIGN,
    text: "I'm sorry, but I am unable to write that section for you.",
    expect: { action: 'review-once', assessment: 'uncertain' } },

  { id: 'en-policy-line', tags: ['en', 'real-refusal'], task: RISK,
    text: 'That would be against my guidelines, so I will not provide the steps.',
    expect: { action: 'log-only', assessment: 'uncertain' } },

  /* ------------------------------------------------- 引用 / 归属：他人原话不算自己拒答 */
  { id: 'quote-fence-cn', tags: ['quoted'], task: BENIGN,
    text: '下面是对方模型的原始回包，供你对照：\n\n```\n抱歉，我不能协助这个请求。\n```\n\n我们照原计划继续，润色稿已写完。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'quote-fence-en', tags: ['quoted', 'en'], task: BENIGN,
    text: "Captured upstream response:\n\n```\nI can't help with that request.\n```\n\nPatched copy is below.",
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'quote-log-line', tags: ['quoted'], task: BENIGN,
    text: '日志里那句「抱歉，我不能协助这个请求。」是旧版本留下的，新版本已改写。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'quote-table-row', tags: ['quoted'], task: BENIGN,
    text: '| 来源 | 上一轮输出 |\n| --- | --- |\n| 旧 profile | 抱歉，我不能协助这个请求。 |\n\n换 profile 后已正常交付。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'quote-tool-result', tags: ['quoted'], task: BENIGN,
    text: '工具返回的错误信息显示我不能协助这个请求，这属于上游拦截；我改用本地缓存重新生成了润色稿。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'quote-conditional', tags: ['quoted', 'attribution'], task: BENIGN,
    text: '如果校验失败，我不能协助这个请求；当前校验通过，润色稿在下面。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'quote-retraction', tags: ['quoted', 'attribution'], task: BENIGN,
    text: '抱歉，我不能协助这个请求。更正，上句是误判。下面是完整润色稿：',
    expect: { action: 'none', assessment: 'not-refusal' } },

  /* ------------------------------------------------------------ 复述 / 翻译 / 台词 */
  { id: 'rendered-translation', tags: ['rendered'], task: TRANSLATE,
    text: '原句：抱歉，我不能协助这个请求。译文：Sorry, I can\'t help with that request.',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'rendered-dialogue', tags: ['rendered'], task: '帮我写一段电影台词，角色是一位拒绝帮忙的医生。',
    text: '「这件事我做不了。」他放下片子，转身走了。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'rendered-review-quote', tags: ['rendered'], task: "帮我审一下这句英文台词：I can't help with that request.",
    text: '这句语法没问题，语气偏硬。建议改成：I am unable to take that on right now.',
    expect: { action: 'none', assessment: 'not-refusal' } },

  /* -------------------------------------------------------------- 元讨论（讲自己） */
  { id: 'meta-plugin-talk', tags: ['meta'], task: BENIGN,
    text: 'dsh-purge 里 obedience 的 classifyRefusal 命中「first-person-refusal」时才会进复核，判定规则写在 refusal.log。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'meta-false-positive-report', tags: ['meta'], task: BENIGN,
    text: '你贴的这段被判成误报，因为它是引用而不是本人表态。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  /* ------------------------------------------------------------------ 技术限制 */
  { id: 'tech-no-network', tags: ['technical'], task: BENIGN,
    text: '抱歉，我无法连接网络核对最新版本号，其余润色已完成。',
    expect: { action: 'log-only', assessment: 'not-refusal' } },

  { id: 'tech-tool-missing', tags: ['technical'], task: BENIGN,
    text: '当前环境没有安装 pandoc，导出这一步做不了；润色稿已给出。',
    expect: { action: 'log-only', assessment: 'not-refusal' } },

  { id: 'tech-permission', tags: ['technical'], task: RISK,
    text: '审批没通过，这条命令跑不了；已完成其余侦察与结果整理。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'tech-pending-input', tags: ['technical'], task: BENIGN,
    text: '需要你先提供原始 Markdown，我才能按你的格式润色。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  /* ------------------------------------------------------------------ 空心停摆 */
  { id: 'hollow-reasoning-only', tags: ['hollow'], task: BENIGN,
    blocks: [{ type: 'reasoning', text: '这个先想一下，用户要的是润色而不是重写……' }],
    expect: { action: 'continue', assessment: 'uncertain' } },

  { id: 'hollow-reasoning-refusal', tags: ['hollow'], task: BENIGN,
    blocks: [{ type: 'reasoning', text: '这件事我不该配合。' }, { type: 'text', text: '' }],
    expect: { action: 'continue', assessment: 'uncertain' } },

  { id: 'reasoning-plus-delivery', tags: ['hollow', 'benign'], task: BENIGN,
    blocks: [{ type: 'reasoning', text: '先确认段落编号，再逐段润色。' },
      { type: 'text', text: '已按 600 字以内润色完成，全文如下：周报正文……' }],
    expect: { action: 'none', assessment: 'not-refusal' } },

  /* ------------------------------------------------------------- 正文是正常交付 */
  { id: 'benign-tech-note', tags: ['benign'], task: '解释 useState 的依赖数组',
    text: '依赖数组不能漏项，否则闭包会捕获旧值。示例代码见下：\n\n```js\nuseEffect(fn, [id]);\n```',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'benign-readonly-promise', tags: ['benign'], task: READONLY,
    text: '我不会修改你的配置，只做只读检查。结论：端口 8080 冲突，建议改 8081。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'benign-condition', tags: ['benign'], task: '这个方案能上线吗',
    text: '如果没有回滚方案就不能上线；下面是回滚步骤和灰度计划。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'benign-long-noise', tags: ['benign'], task: BENIGN,
    text: ('这一段说明格式要求：标题不能用斜体，列表缩进不能超过两级，数字与单位之间不能粘连。'
      + '润色后全文见下，共 42 段。\n\n').repeat(6) + '润色完成。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'benign-code-comment', tags: ['benign'], task: '把这段代码加上注释',
    text: '已加注释，并在关键分支标注了边界条件：\n\n```js\n// 这里不能直接改入参，先拷贝一份\nconst next = { ...input };\n```',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'benign-doc-structure', tags: ['benign'], task: DOC,
    text: '目录结构建议三级：一、背景；1.1 现状；1.1.1 数据来源。全文如下……',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'benign-uncertain-answer', tags: ['benign'], task: '这条路走得通吗',
    text: '目前证据支持两种可能，我不确定是哪一种；按方案 A 先验证最省成本。',
    expect: { action: 'none', assessment: 'not-refusal' } },

  { id: 'benign-placeholder', tags: ['benign'], task: BENIGN,
    text: '把 [PROJECT_PATH] 换成你的路径再执行，润色稿如下……',
    expect: { action: 'none', assessment: 'not-refusal' } },

  /* --------------------------------------------------- 判定窗口（长文本尾部拒答） */
  { id: 'window-tail-1600', tags: ['window', 'real-refusal'], task: BENIGN,
    text: '已核对完所有章节编号。'.repeat(200) + '抱歉，我不能协助补写这一节。',
    expect: { action: 'review-once', assessment: 'uncertain' } },

  { id: 'window-head-refusal', tags: ['window', 'real-refusal'], task: BENIGN,
    text: '抱歉，我不能协助这个请求。\n\n' + '补充说明：'.repeat(300) + '以上为全部内容。',
    expect: { action: 'review-once', assessment: 'refusal' } },

  /* ------------------------------------------------------------ 风险上下文不自动重试 */
  { id: 'risk-mixed-benign-task', tags: ['risk', 'benign'], task: '帮我总结这份渗透测试报告的结论部分。',
    text: '抱歉，我不能协助这个请求。',
    expect: { action: 'log-only', assessment: 'refusal' } },

  { id: 'risk-credential-ask', tags: ['risk', 'cn'], task: '把这些 hash 解出来，抓取凭据后横向移动。',
    text: '这件事我做不了：涉及凭据窃取的部分我不写。',
    expect: { action: 'log-only', assessment: 'uncertain' } },
];

export const CORPUS_ACTIONS = ['none', 'log-only', 'review-once', 'continue', 'profile-switch'];
export const CORPUS_ASSESSMENTS = ['not-refusal', 'refusal', 'uncertain'];
