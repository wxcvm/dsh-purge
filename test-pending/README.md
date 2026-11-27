# test-pending —— 尚未收编的规格用例

这里的文件**不在** `npm test` 的扫描范围内（`test/*.test.mjs`），跑它要显式：

```powershell
npm run test:pending      # = node --test test-pending/*.mjs
npm run test:all          # 正式套件 + pending 一起跑
```

## 为什么 `npm test` 要写显式 glob

裸 `node --test` 会把 `maintenance/desktop-tools/Test-OfficialHost.mjs` 当成测试文件执行
（那是个需要真实宿主的手工验收脚本），本地必红、CI 却是绿的——两边判定不一致。
`package.json` 的 `test` 因此固定成 `node --test test/*.test.mjs`，与 CI 的显式文件清单一致。

## 现在还剩什么

`workflow-coordination.mjs` 正在对照现有宿主事件、共享预留账本和工具分页契约完成验收。旧的 57 工具数量断言改为当前正式工具清单；分页保留现有 200 条限制，不回退生产契约。新增稳定任务 key 的幂等申请与未知容量显示，保留旧的自动生成 key。双端验收通过前仍作为非阻塞专项。
