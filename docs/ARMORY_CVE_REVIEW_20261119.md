# #369 · AboutSecurity 索引独立审查

基准上游：[wgpsec/AboutSecurity](https://github.com/wgpsec/AboutSecurity)，固定提交 `c0d3a4645f26be5b94f64344b501db4191dc9788`（2026-10-24）。

- 11 组 `as-vuln-*.json`、597 条社区漏洞索引，全部 `verified:false`。来源链接改成固定 commit，而非会移动的 `master`。
- Payload 目录元数据：19 组、68 个文件；字典目录元数据：68 组、252 个文件。路径没有检测到绝对路径、`..` 或重复项。
- 只存分类、标题、来源、路径、行数等元信息，不打包上游 Payload/字典内容；历史索引不能证明当前漏洞存在或工具已经安装。
- 导入脚本优先读取 `--repo` 指定仓库实际 Git HEAD；没有 Git 元数据才回退既有离线 manifest。

**尚需人工核实**：上游仓库没有识别到根目录 LICENSE，GitHub 仓库元数据 `license:null`。不能将这一状态解释成明确的再分发许可。发版前应独立确认版权/许可与来源标注。厂商漏洞版本范围也没有逐项复核，仍维持 `community-indexed`、`verified:false`，不虚构验证。

这些结论仅是静态数据审查与测试结果；不代表 Desktop 真实模型投递验证。此轮没有引入新权限限制或运行时网络依赖。
