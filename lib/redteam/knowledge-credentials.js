/**
 * Best-effort local credential review. Never returns matched values or snippets.
 * Not a secret scanner guarantee; ordinary UUID fields may be false positives.
 */
const field = /(?:^|[\s{,[;])["']?(private[_-]?key|auth\.token|(?:api|access|refresh|auth)[_-]?token|token|(?:obfs[_-]?)?password|passwd|secret|uuid|short[_-]?id)["']?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,}\]\r\n#;]+))/gim
const uri = /\b(?:vless|trojan|hysteria2|hy2|ss|socks5h?|https?):\/\/([^\s/@<>"']+)@/gi
const vmess = /\bvmess:\/\/([A-Za-z0-9+/_=-]{16,})/gi
const pem = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g
const placeholder = value => {
  const s = value.trim()
  return !s || /^(?:\$\{[^}]+\}|\$env:[\w]+|\$[A-Z_][A-Z0-9_]*|<[^>]+>|(?:CHANGE[_-]?ME|REPLACE[_-]?ME|YOUR[_-][\w-]+|EXAMPLE|REDACTED|MASKED|PLACEHOLDER|NONE|NULL|TRUE|FALSE)|[*xX]{3,})$/i.test(s)
}
const category = key => /private/i.test(key) ? 'private-key' : /uuid|short/i.test(key) ? 'identifier' : /password|passwd/i.test(key) ? 'password' : 'token-or-secret'

export function inspectKnowledgeCredentials(row = {}) {
  const hits = {}
  const add = key => { hits[key] = (hits[key] || 0) + 1 }
  for (const item of [row, ...(Array.isArray(row.history) ? row.history : [])]) {
    for (const key of ['title','body','category','tags','source']) {
      const value = String(item?.[key] ?? '')
      for (const m of value.matchAll(field)) {
        if (!placeholder(m[2] ?? m[3] ?? m[4] ?? '')) add(category(m[1]))
      }
      for (const m of value.matchAll(uri)) {
        if (!placeholder(m[1])) add('credential-url')
      }
      for (const m of value.matchAll(vmess)) {
        if (!placeholder(m[1])) add('credential-url')
      }
      for (const _ of value.matchAll(pem)) add('private-key')
    }
  }
  return { flagged: Object.keys(hits).length > 0, findings: Object.entries(hits).map(([kind,count]) => ({kind,count})) }
}
