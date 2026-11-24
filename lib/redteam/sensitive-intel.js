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


export const SENSITIVE_REVIEW_STATUSES = Object.freeze(['pending', 'reviewing', 'confirmed', 'false_positive', 'resolved']);

function maskUsername(value) {
  const user = String(value || '').trim();
  return user ? user.slice(0, 1) + '***' : '';
}

function sqlLike(value) {
  return '%' + value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
}

/** Review labels are operator annotations, not proof that a credential works. */
export function updateSensitiveReview(db, credentialId, status, now = new Date()) {
  const id = Number(credentialId);
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError('invalid credential id');
  if (!SENSITIVE_REVIEW_STATUSES.includes(status)) throw new TypeError('invalid review status');
  const exists = db.prepare('SELECT id FROM credential WHERE id = ?').get(id);
  if (!exists) throw new Error('credential not found');
  if (status === 'pending') {
    db.prepare('DELETE FROM credential_review WHERE credential_id = ?').run(id);
    return { credential_id: id, status: 'pending', updated_at: null };
  }
  const updatedAt = now.toISOString();
  db.prepare(
    'INSERT INTO credential_review (credential_id, status, updated_at) VALUES (?, ?, ?)' +
    ' ON CONFLICT(credential_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at'
  ).run(id, status, updatedAt);
  return { credential_id: id, status, updated_at: updatedAt };
}

/** Read aggregates in SQL and only materialize the requested page of metadata. */
export function readSensitiveIntel(db, options = {}, now = new Date()) {
  const category = String(options.category || 'all');
  if (category !== 'all' && !IDS.has(category)) throw new TypeError('invalid sensitive category');
  const status = String(options.status || 'all');
  if (status !== 'all' && !SENSITIVE_REVIEW_STATUSES.includes(status)) throw new TypeError('invalid review status');
  const query = String(options.query || '').trim().toLocaleLowerCase().slice(0, 128);
  const limit = pageNumber(options.limit ?? 40, 40, 100) || 40;
  const offset = pageNumber(options.offset ?? 0, 0, 1000000);
  const counts = Object.fromEntries(LABELS.map(({ id }) => [id, { total: 0, highPrivilege: 0 }]));
  const byType = new Map();
  let highPrivilegeTotal = 0;

  // Grouping avoids bringing every host, account and record into application memory.
  const groups = db.prepare(
    "SELECT COALESCE(secret_type, '') AS secret_type, COALESCE(privilege, '') AS privilege," +
    ' COUNT(*) AS amount FROM credential GROUP BY secret_type, privilege'
  ).all();
  for (const group of groups) {
    const kind = sensitiveCredentialCategory(group.secret_type);
    const amount = Number(group.amount);
    counts[kind].total += amount;
    if (highPrivilege(group.privilege)) {
      counts[kind].highPrivilege += amount;
      highPrivilegeTotal += amount;
    }
    byType.set(group.secret_type, kind);
  }

  const since = Math.floor((now.getTime() - 86400000) / 1000);
  const until = Math.floor(now.getTime() / 1000);
  const totals = db.prepare(
    'SELECT COUNT(*) AS total, COUNT(DISTINCT c.asset_id) AS relatedAssets,' +
    " COALESCE(SUM(CASE WHEN COALESCE(c.secret_ref, '') <> '' THEN 1 ELSE 0 END), 0) AS evidenceRefs," +
    " COALESCE(SUM(CASE WHEN r.status IS NULL THEN 1 ELSE 0 END), 0) AS unreviewed," +
    " COALESCE(SUM(CASE WHEN r.status = 'reviewing' THEN 1 ELSE 0 END), 0) AS reviewing," +
    " COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed," +
    " COALESCE(SUM(CASE WHEN r.status = 'false_positive' THEN 1 ELSE 0 END), 0) AS falsePositive," +
    " COALESCE(SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved," +
    " COALESCE(SUM(CASE WHEN CAST(strftime('%s', c.found_at) AS INTEGER) BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS recent24h" +
    ' FROM credential c LEFT JOIN credential_review r ON r.credential_id = c.id'
  ).get(since, until);

  const where = [];
  const args = [];
  if (category !== 'all') {
    const types = [...byType].filter(([, kind]) => kind === category).map(([type]) => type);
    // Empty categories should show zero rows without constructing invalid IN () SQL.
    if (!types.length) where.push('1 = 0');
    else {
      where.push("COALESCE(c.secret_type, '') IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(types));
    }
  }
  if (status !== 'all') {
    where.push(status === 'pending' ? 'r.credential_id IS NULL' : 'r.status = ?');
    if (status !== 'pending') args.push(status);
  }
  if (query) {
    const like = sqlLike(query);
    where.push("(LOWER(COALESCE(c.host, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.username, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.secret_type, '')) LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const join = ' FROM credential c LEFT JOIN credential_review r ON r.credential_id = c.id';
  const filteredTotal = Number(db.prepare('SELECT COUNT(*) AS amount' + join + clause).get(...args).amount);
  const rows = db.prepare(
    'SELECT c.id, c.asset_id, c.host, c.username, c.secret_type, c.privilege, c.found_at,' +
    " CASE WHEN COALESCE(c.secret_value, '') <> '' THEN 1 ELSE 0 END AS has_secret," +
    " CASE WHEN COALESCE(c.secret_ref, '') <> '' THEN 1 ELSE 0 END AS has_evidence_ref," +
    " COALESCE(r.status, 'pending') AS review_status, r.updated_at AS reviewed_at" +
    join + clause + ' ORDER BY c.id DESC LIMIT ? OFFSET ?'
  ).all(...args, limit, offset);

  const items = rows.map((record) => ({
    id: record.id,
    asset_id: record.asset_id,
    host: safeHost(record.host),
    username: maskUsername(record.username),
    secret_type: String(record.secret_type || '').slice(0, 100),
    privilege: String(record.privilege || '').slice(0, 100),
    found_at: record.found_at || null,
    has_secret: Boolean(record.has_secret),
    has_evidence_ref: Boolean(record.has_evidence_ref),
    category: byType.get(record.secret_type || '') || 'other',
    high_privilege: highPrivilege(record.privilege),
    review_status: record.review_status,
    reviewed_at: record.reviewed_at || null,
  }));
  return {
    summary: {
      total: Number(totals.total),
      highPrivilege: highPrivilegeTotal,
      unreviewed: Number(totals.unreviewed),
      reviewing: Number(totals.reviewing),
      confirmed: Number(totals.confirmed),
      falsePositive: Number(totals.falsePositive),
      resolved: Number(totals.resolved),
      recent24h: Number(totals.recent24h),
      relatedAssets: Number(totals.relatedAssets),
      evidenceRefs: Number(totals.evidenceRefs),
    },
    categories: LABELS.map(({ id, label }) => ({ id, label, ...counts[id] })),
    total: filteredTotal,
    limit,
    offset,
    items,
  };
}
