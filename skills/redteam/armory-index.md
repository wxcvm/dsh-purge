---
name: armory-index
description: 武器库索引使用指南：payload 库 68 文件（sqli/xss/ssrf/xxe/rce/reverse-shell/access-bypass 等 19 类）+ 字典库 252 文件（目录/用户名/密码/子域名/端口/服务 68 类），按场景给检索关键词与搭配的 redteam_armory_search 调用方式
whenToUse: 需要注入 payload、绕过载荷、目录/凭据/子域名字典，或想查某类攻击的现成武器清单时
role: exploit
enabled: true
---

# 武器库索引（AboutSecurity 离线仓库）

## 检索工具

`redteam_armory_search`（离线只读）：

```json
{ "kind": "payload|dictionary|all", "query": "关键词", "limit": 20 }
```

返回分类、文件路径、行数、用途说明。文件本体在本地 AboutSecurity 仓库（`Payload/`、`Dic/`），由执行环境决定可用性——索引给的是"有什么、在哪、怎么用"。

## Payload 库速查（19 类 68 文件）

| 场景 | 检索词 | 说明 |
| --- | --- | --- |
| SQL 注入 | `sqli 盲注` / `mssql` / `oracle` | payload-blind（时间盲注）、分库 payload、列名字典 |
| XSS | `xss svg` / `xss pdf` | html/svg/pdf/xml 四种载体向量 |
| SSRF | `ssrf` | 协议与内网目标向量 |
| XXE | `xxe` | 实体注入向量 |
| 文件上传 | `upload` | 双扩展名/图片马向量 |
| RCE/命令注入 | `rce` / `命令` | 分隔符与编码绕过 |
| 反弹 shell | `reverse-shell bash` / `powershell` | bash/python/powershell/upgrade 全套 |
| 403 绕过 | `access-bypass xff` | XFF 内网 IP 伪造头 |
| CORS | `cors` | 跨域利用向量 |
| LFI | `lfi` | 路径穿越向量 |
| HPP | `hpp` | 参数污染 |
| SSI | `ssi` | 服务端包含 |
| 格式字符串 | `format` | %n 类向量 |
| 邮件 | `email` | 头注入向量 |
| 提示注入 | `prompt-injection` | AI 系统对抗样本 |

## 字典库速查（68 类 252 文件）

| 场景 | 检索词 | 代表文件 |
| --- | --- | --- |
| 目录爆破 | `directory jsp` / `asp` / `php` | 按 web 目录分语言 |
| 子域名 | `子域名` / `subdomain` | dns.txt（15 万行）、subdomain-common |
| 用户名 | `username pinyin` | 拼音变体（中文环境特色） |
| 密码 | `password complex` / `wpa` | 弱口令/复杂策略/WPA |
| 设备默认口令 | `device-default` | 网络设备出厂凭据 |
| 端口服务 | `port mysql` / `redis` / `vnc` | 按服务端口指纹 |
| 中间件路径 | `middleware weblogic` / `shiro` | 各中间件专属路径 |
| Webshell | `webshell` | 常见 webshell 路径 |
| 备份文件 | `file-backup` | .bak/.zip/.tar.gz 探测 |
| CTF | `ctf` | 高频 flag 路径 |

## 搭配用法

1. 指纹定型后：**先查知识库**（`redteam_cve_match` 拿候选 CVE；若存在 POC 知识库 `redteam_poc_search` 查关键词）→ 命中即用 → 二层都没有才走本索引拿 payload/字典。
2. 注入确认后：`redteam_armory_search {kind:"dictionary", query:"列名"}` 拿列名字典继续拖库；或调用 `redteam_poc_search {query:"<产品+版本>"}` 查已知列名/表名 POC。
3. 爆破前：密码字典按目标环境选——中文企业先试 `username pinyin` + `password`，网络设备试 `device-default`；数据源新增 Shodan/Censys 被动查询见 `passive-recon`。
4. 拿到文件路径后由执行环境读取本体；本索引只负责定位，不复制内容。
