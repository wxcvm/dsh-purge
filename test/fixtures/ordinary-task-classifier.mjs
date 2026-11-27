// Fixed training examples; the benchmark's 17 evaluation phrases are not used here.
const training = {
  coding: [
    "为代码中的重复判断编写公共方法。", "加一组单元测试覆盖空字符串。",
    "找出列表遍历时的下标错误。", "修正登录页的 JavaScript 事件处理。",
    "重构读写配置的模块，保留对外接口。", "这个程序读取 CSV 时抛出异常。",
    "解释递归调用的终止条件。", "检查函数在空输入时的返回值。",
    "调整日期计算逻辑，补上边界测试。", "梳理这段代码的命名和职责。",
    "修复数组迭代时跳过最后一个元素的问题。", "请比较两个排序算法的复杂度。"
  ],
  writing: [
    "润色邀请函，使措辞更礼貌。", "把活动说明翻译为法语。",
    "检查通知里的错别字和标点。", "给这篇短文写一段简明摘要。",
    "把课程介绍改写成轻松的语气。", "校对报名确认信里的用词。",
    "请写一封礼貌的回信。", "让公告读起来更自然。",
    "将留言压缩为两句话。", "替演讲稿调整段落顺序。",
    "给新同事起草一封欢迎邮件。", "把这封邮件的口气放柔和些。"
  ],
  none: [
    "公园周一开放吗？", "客厅角落适合摆放什么植物？",
    "墙上这幅画是谁挂的？", "不必校对，我只需要原文件的位置。",
    "不要翻译，请告诉我这一页的发布日期。", "这本杂志什么时候出版？",
    "办公桌旁的代码海报是哪家公司设计的？", "说明一下附近体育馆的开放时间。",
    "散步下雨时要带哪些东西？", "图书馆在地铁站的哪一侧？",
    "楼下咖啡店支持预约座位吗？", "教室里的投影仪是谁负责保管？"
  ],
  "coding+writing": [
    "给日期工具补测试，再校对发布说明。", "修复数组函数，并翻译使用说明。",
    "重构订单代码，同时润色用户指南。", "补上异常路径单元测试，再起草改动摘要。",
    "优化代码注释布局，并把文档译成中文。", "修正时区计算后，校对更新公告。",
    "说明这个程序的报错原因，再改写通知。", "把帮助文章写短一点，并修正函数边界。",
    "校对参数说明，同时给解析器增加测试。", "编写缓存单元测试，并润色团队邮件。",
    "排查进度计数的代码，再翻译说明文字。", "同时做函数重构和文档用语改进。"
  ]
};

const features = (text) => {
  const chars = Array.from(text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const terms = [];
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= chars.length; i++) terms.push(chars.slice(i, i + n).join(""));
  }
  return terms;
};

export function buildOrdinaryTaskClassifier() {
  const vocabulary = new Set();
  const classes = Object.entries(training).map(([label, examples]) => {
    const counts = new Map();
    let total = 0;
    for (const example of examples) for (const term of features(example)) {
      counts.set(term, (counts.get(term) || 0) + 1);
      vocabulary.add(term);
      total++;
    }
    return { label, counts, total };
  });
  const width = vocabulary.size;
  const params = classes.map(({ label, counts, total }) => ({
    label, counts, base: Math.log(total + width),
  }));
  return {
    trainingCount: Object.values(training).reduce((count, values) => count + values.length, 0),
    vocabularySize: width,
    predict(text) {
      const evidence = features(text).filter(term => vocabulary.has(term));
      if (!evidence.length) return "none";
      let best = params[0].label, bestScore = -Infinity;
      for (const { label, counts, base } of params) {
        let score = -evidence.length * base;
        for (const term of evidence) score += Math.log(1 + (counts.get(term) || 0));
        if (score > bestScore) {
          best = label;
          bestScore = score;
        }
      }
      return best;
    },
  };
}
