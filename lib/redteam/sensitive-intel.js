/**
 * Read-only, credential-free projection for the sensitive asset dashboard.
 * Work only with the selected engagement's SQLite handle. Never select
 * secret_value or secret_ref: their contents belong to the vault/old detail flow.
 */
const CLASSIFIERS = [
  { id: 'ssh', label: 'SSH 凭据', match: /(?:^|[._:/\s-])(?:ssh|sftp|scp)(?:$|[._:/\s-])/i },
  { id: 'database', label: '数据库 DSN', match: /(?:^|[._:/\s-])(?:mysql|mariadb|postgres|postgresql|mongo|mongodb|redis|mssql|sqlserver|database|dsn|jdbc)(?:$|[._:/\s-])/i },
  { id: 'cloud', label: '云厂商密钥', match: /(?:^|[._:/\s-])(?:aws|aliyun|alicloud|tencent|azure|gcp|cloud|aksk|ak-sk|access-key)(?:$|[._:/\s-])/i },
  { id: 'keycert', label: '私钥与证书', match: /(?:^|[._:/\s-])(?:private-key|private_key|privatekey|certificate|cert|pem|pfx|pkcs12|keystore|keypair|tls-key)(?:$|[._:/\s-])/i },
  { id: 'api', label: 'API 令牌', match: /(?:^|[._:/\s-])(?:api|apikey|api-key|api_key|bearer|oauth|jwt)(?:$|[._:/\s-])/i },
  { id: 'wallet', label: '资金与钱包', match: /(?:^|[._:/\s-])(?:wallet|seedphrase|seed-phrase|mnemonic|crypto-wallet)(?:$|[._:/\s-])/i },
  { id: 'proxy', label: '代理节点', match: /(?:^|[._:/\s-])(?:proxy|socks5|vless|hysteria2|hy2)(?:$|[._:/\s-])/i },
  { id: 'cookie', label: 'Cookie 会话', match: /(?:^|[._:/\s-])(?:cookie|session-cookie|sessionid)(?:$|[._:/\s-])/i },
  { id: 'panel', label: '后台与面板', match: /(?:^|[._:/\s-])(?:admin-panel|panel|dashboard|webadmin|admin-login|后台)(?:$|[._:/\s-])/i },
];

const LABELS = [...CLASSIFIERS.map(({ id, label }) => ({ id, label })), { id: 'other', label: '未分类' }];
const IDS = new Set(LABELS.map((c) => c.id));

export function sensitiveCredentialCategory(secretType) {
  const type = String(secretType || '').trim();
  return CLASSIFIERS.find((rule) => rule.match.test(type))?.id || 'other';
}

function highPrivilege(value) {
  return /(?:^|[\s,;/_-])(?:root|admin|administrator|system|domain.admin)(?:$|[\s,;/_-])/i.test(String(value || ''));
}

function pageNumber(value, fallback, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

function safeHost(raw) {
  const host = String(raw || '');
  // Never project URL userinfo, path, query or fragment as host metadata.
  if (host.includes('://')) {
    try { return new URL(host).host.slice(0, 256); } catch { /* use strict fallback */ }
  }
  const withoutUserinfo = host.includes('@') ? host.slice(host.lastIndexOf('@') + 1) : host;
  return withoutUserinfo.split(/[/?#]/, 1)[0].slice(0, 256);
}

export function readSensitiveIntel(db, options = {}, now = new Date()) {
  const category = String(options.category || 'all');
  if (category !== 'all' && !IDS.has(category)) throw new TypeError('invalid sensitive category');
  const search = String(options.query || '').trim().toLocaleLowerCase().slice(0, 128);
  const limit = pageNumber(options.limit ?? 40, 40, 100) || 40;
  const offset = pageNumber(options.offset ?? 0, 0, 1000000);
  const since = now.getTime() - 24 * 60 * 60 * 1000;

  // Explicit projection: no secret_value, secret_ref, note, request or response.
  // The two booleans are computed by SQLite without bringing secrets to JS.
  const rows = db.prepare(
    "SELECT id, asset_id, host, username, secret_type, privilege, found_at," +
    " CASE WHEN COALESCE(secret_value, '') <> '' THEN 1 ELSE 0 END AS has_secret," +
    " CASE WHEN COALESCE(secret_ref, '') <> '' THEN 1 ELSE 0 END AS has_evidence_ref" +
    " FROM credential ORDER BY id DESC"
  ).all();

  const counts = Object.fromEntries(LABELS.map(({ id }) => [id, { total: 0, highPrivilege: 0 }]));
  const assets = new Set();
  let highPrivilegeTotal = 0;
  let recent24h = 0;
  let evidenceRefs = 0;
  const items = rows.map((record) => {
    const item = {
      id: record.id,
      asset_id: record.asset_id,
      host: safeHost(record.host),
      username: String(record.username || '').slice(0, 160),
      secret_type: String(record.secret_type || '').slice(0, 100),
      privilege: String(record.privilege || '').slice(0, 100),
      found_at: record.found_at || null,
      has_secret: Boolean(record.has_secret),
      has_evidence_ref: Boolean(record.has_evidence_ref),
      category: sensitiveCredentialCategory(record.secret_type),
      high_privilege: highPrivilege(record.privilege),
    };
    counts[item.category].total++;
    if (item.high_privilege) {
      counts[item.category].highPrivilege++;
      highPrivilegeTotal++;
    }
    if (item.asset_id != null) assets.add(String(item.asset_id));
    if (item.has_evidence_ref) evidenceRefs++;
    const timestamp = typeof item.found_at === 'string' ? Date.parse(item.found_at) : NaN;
    if (Number.isFinite(timestamp) && timestamp >= since && timestamp <= now.getTime()) recent24h++;
    return item;
  });

  const filtered = items.filter((item) =>
    (category === 'all' || item.category === category) &&
    (!search || [item.host, item.username, item.secret_type].some((s) => s.toLocaleLowerCase().includes(search)))
  );

  return {
    summary: {
      total: rows.length,
      highPrivilege: highPrivilegeTotal,
      unreviewed: rows.length, // Legacy records have no review status; do not imply verification.
      recent24h,
      relatedAssets: assets.size,
      evidenceRefs,
    },
    categories: LABELS.map(({ id, label }) => ({ id, label, ...counts[id] })),
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit),
  };
}
