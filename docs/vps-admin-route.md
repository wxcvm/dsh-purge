# VPS 多跳管理连接检查（独立模块）

该模块用于检查用户自有服务器及授权实验室的 SSH 管理路径，不是通用代理、
流量转发或红队工具出口切换功能。现有环境适配中的单 VPS 配置保持不变。

## 使用

1. 在本机 OpenSSH 配置中为自己的管理节点设置独立 Host 别名、地址、用户名和密钥路径。
2. 通过正常的服务器管理流程确认每个节点的 SSH 主机密钥，将它们加入本机 known_hosts。
3. 在环境适配中保存管理路径后，从 Purge 安装目录运行 `node scripts/vps-admin-check.mjs --saved`，直接使用已保存的路径。该命令读取 `$DSH_HOME/redteam/config.json`（未设置 DSH_HOME 时使用 `~/.dsh/redteam/config.json`）。缺失或无效配置会报错，不会改走其他节点。
4. 如需临时检查，也可以从仓库根目录直接指定别名：

```sh
node scripts/vps-admin-check.mjs lab
node scripts/vps-admin-check.mjs lab entry
node scripts/vps-admin-check.mjs lab entry,bastion
```

别名 lab、entry、bastion 必须替换成自己已有的 SSH Host 别名。跳板按填写顺序使用。
目标需要允许 SSH 执行无副作用的 true 命令，跳板需允许对应的 SSH 管理连接。
非交互认证失败、主机密钥未确认或超时会返回失败，不会改走直连。
SSH 别名的实际地址、认证和跳板连接策略由本机 OpenSSH 配置决定，
请在每个自有节点的 Host 配置中启用主机密钥检查并关闭不需要的转发。
请不要在配置中使用不受信任的 ProxyCommand 或 LocalCommand。

## 范围与限制

- 最多四个显式跳板，使用系统 OpenSSH，不安装新网络内核。
- 不保存密码、不导出密钥、不开放本地 SOCKS 端口、不修改系统代理、DNS 或 TUN。
- 只执行固定的连通性命令，不向既有红队工具传递路由。
- 成功仅代表该次 SSH 连接可用，不证明各跳物理网络独立，也不证明匿名性。
- 环境适配提供独立管理路径配置、顺序调整、校验与本机检查命令；界面不主动发起 SSH 连接。

测试：`node --test test/vps-admin-check.test.mjs`

## 环境适配界面

进入「环境适配 → SSH 多跳管理路径（独立）」，填写最终管理服务器的 Host 别名，按顺序添加跳板。使用上下箭头调整顺序，删除不需要的跳板；点击环境适配的保存按钮持久化。清空目标并删除所有跳板可停用此配置。

格式有效时，界面展示实际顺序和可在 Purge 安装目录本机终端执行的检查命令。保存后使用 --saved，无需再次填写节点。配置格式有效不代表 SSH 连通，也不代表节点在线。保存路径不触发网络连接；实际检查必须由操作者在本机运行。
