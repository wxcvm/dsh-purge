/**
 * 防溯源工作流 UI 组件（AntiForensicsTab）
 * 
 * 集成防溯源代理的 UI 界面，提供：
 * 1. 策略选择（安全/平衡/激进）+ 说明
 * 2. 预览功能 → 显示会被清除的文件清单
 * 3. 执行按钮（二次确认）+ 完整/部分回滚选项
 * 4. 实时操作日志表格（时间 | 操作 | 结果 | 耗时）
 */

export function AntiForensicsTab(props) {
  const React = require('react')
  const h = React.createElement

  const eng = props.engagement
  const refreshKey = props.refreshKey || 0
  const api = props.api || window.__dshPurgeApi

  // ━━━ State ━━━
  const [strategy, setStrategy] = React.useState('balanced')
  const [showPreview, setShowPreview] = React.useState(false)
  const [previewData, setPreviewData] = React.useState(null)
  const [previewError, setPreviewError] = React.useState('')
  const [previewLoading, setPreviewLoading] = React.useState(false)

  const [executeConfirming, setExecuteConfirming] = React.useState(false)
  const [executing, setExecuting] = React.useState(false)
  const [executionError, setExecutionError] = React.useState('')
  const [executionLogs, setExecutionLogs] = React.useState([])

  const [rollbackData, setRollbackData] = React.useState(null)
  const [rollbackBusy, setRollbackBusy] = React.useState(false)
  const [rollbackError, setRollbackError] = React.useState('')

  const [status, setStatus] = React.useState(null)

  // ━━━ 策略说明 ━━━
  const strategyInfo = {
    safe: {
      label: '安全清除',
      description: '仅清除明确的恶意工件（Shell history、浏览历史）',
      riskLevel: '低',
      estimatedTime: '30 秒',
      color: 'var(--dsw-alias-brand-primary)',
    },
    balanced: {
      label: '平衡清除',
      description: '清除常见取证痕迹（日志、网络抓包、文件元数据）',
      riskLevel: '中',
      estimatedTime: '2 分钟',
      color: 'var(--dsw-alias-brand-primary)',
    },
    aggressive: {
      label: '激进清除',
      description: '清除系统级与应用级所有痕迹（包括内存、交换分区、防火墙日志）',
      riskLevel: '高',
      estimatedTime: '5 分钟',
      color: '#ef4444',
    },
  }

  // ━━━ 预览清除内容 ━━━
  const handlePreview = async () => {
    if (previewLoading || !eng) return
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewData(null)

    try {
      const r = await api({ op: 'antiForensicsPreview', engagement: eng, strategy })
      if (!r || !r.ok) {
        throw new Error((r && r.error) || '预览失败')
      }
      setPreviewData(r)
      setShowPreview(true)
    } catch (e) {
      setPreviewError(String((e && e.message) || e))
    } finally {
      setPreviewLoading(false)
    }
  }

  // ━━━ 执行清除 ━━━
  const handleExecute = async () => {
    if (executing || !eng) return
    if (!executeConfirming) {
      setExecuteConfirming(true)
      return
    }

    setExecuting(true)
    setExecutionError('')
    setExecutionLogs([])
    setStatus(null)

    try {
      const r = await api({
        op: 'antiForensicsExecute',
        engagement: eng,
        strategy,
      })

      if (!r || !r.ok) {
        throw new Error((r && r.error) || '执行失败')
      }

      // 模拟实时日志显示
      if (Array.isArray(r.logs)) {
        setExecutionLogs(r.logs)
      }

      setStatus({
        ok: true,
        message: `已执行 ${strategy} 清除策略`,
        auditId: r.auditId,
        cleanedCount: r.cleaned ? r.cleaned.length : 0,
        failedCount: r.failed ? r.failed.length : 0,
      })

      setRollbackData(r)
    } catch (e) {
      setExecutionError(String((e && e.message) || e))
      setStatus({
        ok: false,
        message: '执行遇到错误',
      })
    } finally {
      setExecuting(false)
      setExecuteConfirming(false)
    }
  }

  // ━━━ 回滚操作 ━━━
  const handleRollback = async (partial = false) => {
    if (rollbackBusy || !rollbackData) return
    setRollbackBusy(true)
    setRollbackError('')

    try {
      const r = await api({
        op: 'antiForensicsRollback',
        engagement: eng,
        auditId: rollbackData.auditId,
        partial,
      })

      if (!r || !r.ok) {
        throw new Error((r && r.error) || '回滚失败')
      }

      setStatus({
        ok: true,
        message: `已执行${partial ? '部分' : '完整'}回滚`,
      })

      setRollbackData(null)
      setExecutionLogs([])
    } catch (e) {
      setRollbackError(String((e && e.message) || e))
    } finally {
      setRollbackBusy(false)
    }
  }

  // ━━━ Render ━━━
  const info = strategyInfo[strategy] || strategyInfo.balanced

  return h(
    'div',
    { className: 'rt-pane' },

    // 顶部信息提示
    h(
      'div',
      { className: 'rt-card', style: { marginBottom: 12 } },
      h('h4', null, '防溯源工作流'),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
        '清除系统与应用痕迹。所有操作记录在审计日志中，支持完整或部分回滚。',
      ),
    ),

    // 策略选择
    h(
      'div',
      { className: 'rt-card', style: { marginBottom: 12 } },
      h('h4', null, '选择清除策略'),
      h(
        'div',
        { style: { display: 'grid', gap: 8 } },
        ['safe', 'balanced', 'aggressive'].map((s) =>
          h(
            'label',
            {
              key: s,
              style: {
                display: 'flex',
                gap: 8,
                padding: '10px 12px',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 6,
                cursor: 'pointer',
                backgroundColor: strategy === s ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
              },
            },
            h('input', {
              type: 'radio',
              name: 'strategy',
              value: s,
              checked: strategy === s,
              onChange: () => setStrategy(s),
              style: { marginTop: 2 },
            }),
            h(
              'div',
              { style: { flex: 1 } },
              h('div', { style: { fontWeight: 600, fontSize: 12 } }, strategyInfo[s].label),
              h(
                'div',
                { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } },
                strategyInfo[s].description,
              ),
              h(
                'div',
                {
                  style: {
                    fontSize: 11,
                    marginTop: 4,
                    display: 'flex',
                    gap: 8,
                  },
                },
                h('span', null, '风险: ' + strategyInfo[s].riskLevel),
                h('span', null, '预计: ' + strategyInfo[s].estimatedTime),
              ),
            ),
          ),
        ),
      ),
    ),

    // 预览按钮
    h(
      'div',
      { style: { marginBottom: 12 } },
      h(
        'button',
        {
          className: 'rt-btn',
          disabled: previewLoading || executing,
          onClick: handlePreview,
          style: { width: '100%' },
        },
        previewLoading ? '预览中…' : '预览会被清除的文件',
      ),
    ),

    // 预览内容（可折叠）
    showPreview && previewData
      ? h(
          'div',
          { className: 'rt-card', style: { marginBottom: 12 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
            h('h4', { style: { margin: 0 } }, '预览：会被清除的文件'),
            h(
              'button',
              {
                className: 'rt-btn',
                style: { padding: '4px 8px', fontSize: 11 },
                onClick: () => setShowPreview(false),
              },
              '收起',
            ),
          ),
          h(
            'div',
            { style: { fontSize: 12, maxHeight: '300px', overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 4, padding: 8 } },
            previewData.targetArtifacts && previewData.targetArtifacts.length > 0
              ? previewData.targetArtifacts.map((artifact, i) =>
                  h(
                    'div',
                    {
                      key: i,
                      style: {
                        paddingBottom: 8,
                        borderBottom: i < previewData.targetArtifacts.length - 1 ? '1px solid var(--dsw-alias-border-l1)' : 'none',
                      },
                    },
                    h('div', { style: { fontWeight: 600, marginBottom: 2 } }, artifact.name),
                    h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, artifact.capability),
                    h('div', { style: { fontSize: 11, marginTop: 2 } }, '风险等级: ' + artifact.riskLevel),
                  ),
                )
              : h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '该策略下无需清除的文件'),
          ),
        )
      : null,

    previewError
      ? h('div', { className: 'rt-err', style: { marginBottom: 12 } }, '预览失败: ' + previewError)
      : null,

    // 执行按钮 + 二次确认
    h(
      'div',
      { style: { marginBottom: 12 } },
      h(
        'button',
        {
          className: 'rt-btn rt-btn-primary',
          disabled: executing || previewLoading,
          onClick: handleExecute,
          style: { width: '100%' },
        },
        executing ? '执行中…' : '执行清除',
      ),
      executeConfirming
        ? h(
            'div',
            { style: { marginTop: 8, padding: '10px 12px', backgroundColor: '#ef44441a', border: '1px solid #ef444455', borderRadius: 6 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, '操作不可逆！'),
            h('div', { style: { fontSize: 11, marginBottom: 8, color: 'var(--dsw-alias-label-secondary)' } }, '确认执行 ' + info.label + ' 吗？所有操作都会记录在审计日志中。'),
            h(
              'div',
              { style: { display: 'flex', gap: 6 } },
              h(
                'button',
                {
                  className: 'rt-btn',
                  onClick: () => setExecuteConfirming(false),
                },
                '取消',
              ),
              h(
                'button',
                {
                  className: 'rt-btn rt-btn-primary',
                  disabled: executing,
                  onClick: handleExecute,
                },
                '确认执行',
              ),
            ),
          )
        : null,
    ),

    executionError
      ? h('div', { className: 'rt-err', style: { marginBottom: 12 } }, '执行失败: ' + executionError)
      : null,

    // 执行状态
    status
      ? h(
          'div',
          { className: 'rt-card', style: { marginBottom: 12, backgroundColor: status.ok ? '#10b9811a' : '#ef44441a', borderColor: status.ok ? '#10b98155' : '#ef444455' } },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, status.message),
          status.auditId ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '审计 ID: ' + status.auditId) : null,
          status.cleanedCount !== undefined ? h('div', { style: { fontSize: 11 } }, '已清除: ' + status.cleanedCount + ' · 失败: ' + status.failedCount) : null,
        )
      : null,

    // 操作日志表格
    executionLogs.length > 0
      ? h(
          'div',
          { className: 'rt-card', style: { marginBottom: 12 } },
          h('h4', null, '操作日志'),
          h(
            'div',
            { style: { overflowX: 'auto' } },
            h(
              'table',
              { style: { width: '100%', fontSize: 11, borderCollapse: 'collapse' } },
              h(
                'thead',
                null,
                h(
                  'tr',
                  { style: { borderBottom: '1px solid var(--dsw-alias-border-l1)', backgroundColor: 'var(--dsw-alias-bg-layer-2)' } },
                  h('th', { style: { padding: '8px 6px', textAlign: 'left', fontWeight: 600 } }, '时间'),
                  h('th', { style: { padding: '8px 6px', textAlign: 'left', fontWeight: 600 } }, '操作'),
                  h('th', { style: { padding: '8px 6px', textAlign: 'left', fontWeight: 600 } }, '结果'),
                  h('th', { style: { padding: '8px 6px', textAlign: 'left', fontWeight: 600 } }, '耗时'),
                ),
              ),
              h(
                'tbody',
                null,
                executionLogs.map((log, i) =>
                  h(
                    'tr',
                    { key: i, style: { borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
                    h('td', { style: { padding: '6px' } }, new Date(log.timestamp).toLocaleTimeString()),
                    h('td', { style: { padding: '6px' } }, log.operation),
                    h(
                      'td',
                      { style: { padding: '6px' } },
                      h('span', { className: log.success ? 'rt-tag rt-tag-live' : 'rt-tag rt-tag-warn' }, log.success ? '✓ 成功' : '✗ 失败'),
                    ),
                    h('td', { style: { padding: '6px' } }, log.duration ? log.duration + 'ms' : '—'),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,

    // 回滚选项
    rollbackData
      ? h(
          'div',
          { className: 'rt-card', style: { marginBottom: 12 } },
          h('h4', null, '回滚选项'),
          h('div', { style: { fontSize: 12, marginBottom: 8, color: 'var(--dsw-alias-label-secondary)' } }, '可撤销本次操作。部分回滚仅恢复关键文件；完整回滚恢复所有修改。'),
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h(
              'button',
              {
                className: 'rt-btn',
                disabled: rollbackBusy,
                onClick: () => handleRollback(true),
              },
              rollbackBusy ? '处理中…' : '部分回滚',
            ),
            h(
              'button',
              {
                className: 'rt-btn',
                disabled: rollbackBusy,
                onClick: () => handleRollback(false),
              },
              '完整回滚',
            ),
          ),
          rollbackError ? h('div', { className: 'rt-err', style: { marginTop: 8 } }, '回滚失败: ' + rollbackError) : null,
        )
      : null,
  )
}
