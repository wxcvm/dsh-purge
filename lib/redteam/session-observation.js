/** Display recorded observations without interpreting a connection as service health. */
export function sessionObservation(row, kind) {
  const note = String(row?.check_note || '')
  const checked = Boolean(row?.last_check)
  const status = String(row?.status || '')
  if (note === '界面手动标记') return { kind: 'manual', checked: false, application: 'not_tested', udp: 'not_tested' }
  if (!checked) return { kind: 'unverified', checked: false, application: 'not_tested', udp: 'not_tested' }
  if (kind === 'tunnel' && note === 'TCP connected (listener only)' && status === 'active')
    return { kind: 'tcp_connected', checked: true, application: 'not_tested', udp: 'not_tested' }
  if (kind === 'webshell' && /^HTTP \d{3}$/.test(note))
    return { kind: 'http_response', checked: true, application: 'not_tested', udp: 'not_tested' }
  return { kind: 'recorded', checked: true, application: 'not_tested', udp: 'not_tested' }
}
