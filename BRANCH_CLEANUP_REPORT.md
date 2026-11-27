# dsh-purge 仓库分支清理报告

**生成时间**: 2026-11-26 12:35 UTC+8  
**仓库**: https://github.com/wxcvm/dsh-purge  
**当前 master**: `1554031` (fix: update install URLs to v1.1.92-wxcvm.28)

---

## 📊 清理摘要

### 本地分支处理
- **已删除** (操作前): 0 个
- **已合并到 master**: 10 个 ✓
- **活跃未合并** (< 7 天): 1 个
- **旧未合并** (> 7 天): 0 个

### 远程分支处理
- **总计**: 85 个远程分支
- **已分类统计**:
  - `feat/fix` 分支: 11 个
  - `release` 分支: 21 个 (17 个已发布，4 个无对应 tag)
  - `candidate` 分支: 4 个 (待保留作历史档案)
  - `beta` 分支: 1 个
  - `codex` 分支: 14 个 (开发工作分支)
  - `robin` 分支: 25 个 (测试/质量分支)
  - `backup` 分支: 2 个 (历史备份)
  - `chore` 分支: 2 个
  - `diag` 分支: 1 个
  - `ci` 分支: 2 个
  - `ui` 分支: 1 个
  - 其他: 1 个

---

## 📋 详细分析

### 1. 本地分支（已合并）

以下分支已完全合并到 master，可安全删除:

| 分支名 | 提交 | 状态 |
|--------|------|------|
| feat/agent-attention-ui-badges-20261125 | 1b610e2 | ✓ 已合并 |
| feat/alpha2-compatibility-check-20261125 | e7a3875 | ✓ 已合并 |
| feat/audit-log-manager-20261126 | a099262 | ✓ 已合并 |
| feat/config-persistence-boundary-20261125 | ac360e8 | ✓ 已合并 |
| feat/desktop-acceptance-script-20261125 | 8facbaf | ✓ 已合并 |
| feat/forensics-evasion-agent-framework-20261125 | 9294a32 | ✓ 已合并 |
| feat/linux-forensics-evasion-agent-20261125 | cc0b1fb | ✓ 已合并 |
| feat/scan-preferences-policy-refactor-20261125 | e7a3875 | ✓ 已合并 |
| feat/shell-executor-integration-20261126 | 785360d | ✓ 已合并 |
| feat/windows-forensics-evasion-agent-20261125 | b163ed8 | ✓ 已合并 |

**操作**: 本地删除 + 推送删除到 origin

---

### 2. 本地分支（活跃未合并）

| 分支名 | 提交 | 最后更新 | 状态 |
|--------|------|---------|------|
| feat/shodan-api-settings-20261125 | e9635cb | 2026-11-25 22:04:55 | ⚠️ 待合并 |

**说明**: 此分支仍在活跃开发中（< 24h），建议保留或尽快合并到 master。

---

### 3. 远程 Release 分支分析

#### 3.1 已发布（有对应 tag）- 建议删除

以下 17 个分支已发布为 release tag，远程分支可删除：

```
✓ release/v1.1.92-wxcvm.10 → tag: v1.1.92-wxcvm.10
✓ release/v1.1.92-wxcvm.11 → tag: v1.1.92-wxcvm.11
✓ release/v1.1.92-wxcvm.12 → tag: v1.1.92-wxcvm.12
✓ release/v1.1.92-wxcvm.13 → tag: v1.1.92-wxcvm.13
✓ release/v1.1.92-wxcvm.14 → tag: v1.1.92-wxcvm.14
✓ release/v1.1.92-wxcvm.15 → tag: v1.1.92-wxcvm.15
✓ release/v1.1.92-wxcvm.16 → tag: v1.1.92-wxcvm.16
✓ release/v1.1.92-wxcvm.17 → tag: v1.1.92-wxcvm.17
✓ release/v1.1.92-wxcvm.18 → tag: v1.1.92-wxcvm.18
✓ release/v1.1.92-wxcvm.19 → tag: v1.1.92-wxcvm.19
✓ release/v1.1.92-wxcvm.20 → tag: v1.1.92-wxcvm.20
✓ release/v1.1.92-wxcvm.21 → tag: v1.1.92-wxcvm.21
✓ release/v1.1.92-wxcvm.22 → tag: v1.1.92-wxcvm.22
✓ release/v1.1.92-wxcvm.23 → tag: v1.1.92-wxcvm.23
✓ release/v1.1.92-wxcvm.24 → tag: v1.1.92-wxcvm.24
✓ release/v1.1.92-wxcvm.25-rc.1 → tag: v1.1.92-wxcvm.25-rc.1
✓ release/v1.1.92-wxcvm.26-rc.1 → tag: v1.1.92-wxcvm.26-rc.1
```

**操作**: 推送删除到 origin（tag 保留作版本历史）

#### 3.2 未发布（无对应 tag）- 确认后删除

以下 4 个分支无对应 tag，属临时分支：

```
✗ release/publish-beta-7-beta-11
✗ release/publish-beta-7-beta-3
✗ release/publish-wxcvm-6-8470eec
✗ release/wxcvm-6-package-preflight
```

**操作**: 推送删除到 origin（需用户确认）

---

### 4. 候选/测试分支（需确认保留策略）

#### 4.1 Candidate 分支（4 个）- 建议保留作历史档案

```
origin/candidate/v1.1.92-wxcvm.20
origin/candidate/v1.1.92-wxcvm.21
origin/candidate/v1.1.92-wxcvm.22
origin/candidate/v1.1.92-wxcvm.23
```

**说明**: 这些是 release candidate 分支，记录了各版本的发布前状态。建议保留作历史档案。

#### 4.2 其他开发分支

- **Codex 分支** (14 个): 长期开发分支，建议按项目完成状态逐个确认
- **Robin 分支** (25 个): 测试/质量保证分支，建议保留直到对应功能发布
- **Backup 分支** (2 个): 历史备份，建议存档
- **Beta 分支** (1 个): 当前维护分支，建议保留

---

## ✅ 建议操作清单

### 阶段 1：本地分支清理（无风险）

```bash
# 删除已合并的本地分支
git branch -d feat/agent-attention-ui-badges-20261125
git branch -d feat/alpha2-compatibility-check-20261125
git branch -d feat/audit-log-manager-20261126
git branch -d feat/config-persistence-boundary-20261125
git branch -d feat/desktop-acceptance-script-20261125
git branch -d feat/forensics-evasion-agent-framework-20261125
git branch -d feat/linux-forensics-evasion-agent-20261125
git branch -d feat/scan-preferences-policy-refactor-20261125
git branch -d feat/shell-executor-integration-20261126
git branch -d feat/windows-forensics-evasion-agent-20261125
```

### 阶段 2：远程分支清理（已发布 release）

```bash
# 推送删除已发布的 release 分支（tag 仍保留）
git push origin --delete release/v1.1.92-wxcvm.10
git push origin --delete release/v1.1.92-wxcvm.11
git push origin --delete release/v1.1.92-wxcvm.12
git push origin --delete release/v1.1.92-wxcvm.13
git push origin --delete release/v1.1.92-wxcvm.14
git push origin --delete release/v1.1.92-wxcvm.15
git push origin --delete release/v1.1.92-wxcvm.16
git push origin --delete release/v1.1.92-wxcvm.17
git push origin --delete release/v1.1.92-wxcvm.18
git push origin --delete release/v1.1.92-wxcvm.19
git push origin --delete release/v1.1.92-wxcvm.20
git push origin --delete release/v1.1.92-wxcvm.21
git push origin --delete release/v1.1.92-wxcvm.22
git push origin --delete release/v1.1.92-wxcvm.23
git push origin --delete release/v1.1.92-wxcvm.24
git push origin --delete release/v1.1.92-wxcvm.25-rc.1
git push origin --delete release/v1.1.92-wxcvm.26-rc.1
```

### 阶段 3：临时分支清理（需确认）

```bash
# ⚠️ 推送删除无 tag 的临时分支（需用户确认）
git push origin --delete release/publish-beta-7-beta-11
git push origin --delete release/publish-beta-7-beta-3
git push origin --delete release/publish-wxcvm-6-8470eec
git push origin --delete release/wxcvm-6-package-preflight
```

---

## 📝 确认项

在执行删除前，请确认：

- [ ] 本地分支清理：10 个已合并分支删除
- [ ] 远程 release 分支清理：17 个已发布分支删除
- [ ] 临时分支处理：4 个无 tag 的 publish-* 分支是否删除？
- [ ] Candidate 分支保留作历史档案
- [ ] Codex/Robin/开发分支按项目状态逐个决策
- [ ] feat/shodan-api-settings-20261125 是否需要合并或保留？

---

## 🔍 清理前检查清单

```bash
# 1. 验证本地分支状态
git branch -v

# 2. 验证远程分支数量
git branch -r | wc -l

# 3. 验证 master 未改变
git log -1 --oneline master

# 4. 确认没有未提交改动
git status
```

---

## 📌 保留策略

| 分支类型 | 保留 | 说明 |
|---------|------|------|
| 已合并本地分支 | ❌ | 删除（已并入 master） |
| 活跃未合并本地分支 | ⏳ | 待用户决策 |
| 已发布 release 分支 | ❌ | 删除（tag 已存档） |
| 临时 publish-* 分支 | ❌ | 删除（需确认） |
| Candidate 分支 | ✅ | 保留（历史档案） |
| Codex 分支 | ⏳ | 按项目状态决策 |
| Robin 分支 | ✅ | 保留（测试分支） |
| Backup 分支 | ✅ | 保留（历史备份） |

---

## 🎯 清理效果预期

**执行后**:
- 本地分支: 1 → 2 (仅保留 master + feat/shodan-api-settings-20261125)
- 远程分支: 85 → ~63
  - 删除已发布 release: -17
  - 删除临时 publish-*: -4
  - 保留开发分支: ~63

**好处**:
- ✓ 降低分支管理复杂度
- ✓ 加快 Git 操作速度
- ✓ 保留完整版本历史（通过 tag）
- ✓ 保留活跃开发分支

